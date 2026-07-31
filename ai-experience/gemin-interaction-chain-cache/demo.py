from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import ssl
import sys
import uuid
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import google.genai as genai
from dotenv import dotenv_values
from google.genai.interactions import Interaction
from pydantic import BaseModel, ConfigDict, StrictStr

SYSTEM_INSTRUCTION = "完成用户需求。"
DEFAULT_MODEL = "gemini-3-flash-preview"
DEFAULT_ESSAY_CHARS = 6000
DEFAULT_FIRST_PROMPT_CHARS = 8000
DEFAULT_ROUND_DELAY_SECONDS = 10.0
DEFAULT_TOPIC = "一座城市公共图书馆从清晨到夜晚的一天"
DEFAULT_TEMPERATURE = 0.1
DEFAULT_THINKING_LEVEL = "low"
DEFAULT_MAX_OUTPUT_TOKENS = 12000
MIN_CACHE_TOKENS = 4096
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/"
SCRIPT_DIRECTORY = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIRECTORY.parents[1]
DEFAULT_OUTPUT_DIRECTORY = SCRIPT_DIRECTORY / "output"


class DemoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: StrictStr


@dataclass(frozen=True)
class DemoConfig:
    model: str
    essay_chars: int
    first_prompt_chars: int
    round_delay_seconds: float
    topic: str
    output_directory: Path


@dataclass(frozen=True)
class DemoRunResult:
    run_directory: Path
    succeeded: bool


def response_format() -> dict[str, object]:
    return {
        "type": "text",
        "mime_type": "application/json",
        "schema": DemoResponse.model_json_schema(),
    }


def build_contract(config: DemoConfig) -> dict[str, object]:
    return {
        "model": config.model,
        "system_instruction": SYSTEM_INSTRUCTION,
        "response_format": response_format(),
        "generation_config": {
            "temperature": DEFAULT_TEMPERATURE,
            "thinking_level": DEFAULT_THINKING_LEVEL,
            "max_output_tokens": DEFAULT_MAX_OUTPUT_TOKENS,
        },
        "store": True,
    }


def contract_fingerprint(contract: Mapping[str, object]) -> str:
    payload = json.dumps(
        contract,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def content_fingerprint(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def build_first_prompt(
    *,
    run_id: str,
    essay_chars: int,
    first_prompt_chars: int,
    topic: str,
) -> str:
    lines = [
        f"run_id: {run_id}",
        f"请围绕“{topic}”写一篇完整作文。",
        f"正文不得少于 {essay_chars} 个中文汉字。",
        "文章应有标题、连贯的段落和完整结尾，不得用提纲或重复句子凑字数。",
        "请将作文全文放入 Structured Output 的 content 字段。",
        "以下是详细写作要求。语义相近的要求可以合并落实，不要在正文中逐条复述要求本身。",
    ]
    phases = (
        "清晨开馆前",
        "上午读者入馆时",
        "正午光线变化时",
        "下午活动进行时",
        "傍晚人群交替时",
        "夜间闭馆前",
        "工作人员整理书架时",
        "不同年龄读者相遇时",
    )
    aspects = (
        "空间布局",
        "人物动作",
        "环境声音",
        "光影变化",
        "公共服务",
        "阅读感受",
        "城市联系",
        "细节物件",
        "时间推进",
        "情绪转折",
    )
    focuses = (
        "可观察的具体细节",
        "前后呼应的叙事线索",
        "自然发生的人物互动",
        "不夸张的真实体验",
        "公共空间的秩序与温度",
        "知识传播带来的细微变化",
        "不同人物视角之间的联系",
        "场景变化对主题的推动",
    )
    prompt_length = len("\n".join(lines))
    requirement_number = 1
    while prompt_length < first_prompt_chars:
        phase = phases[(requirement_number - 1) % len(phases)]
        aspect = aspects[(requirement_number - 1) % len(aspects)]
        focus = focuses[(requirement_number - 1) % len(focuses)]
        requirement = (
            f"{requirement_number}. 描写{phase}时，从{aspect}展开，重点呈现{focus}；"
            "使用自然、准确且连贯的中文表达，让该段内容服务于全文主题，并与相邻段落形成清晰联系。"
        )
        lines.append(requirement)
        prompt_length += len(requirement) + 1
        requirement_number += 1
    return "\n".join(lines)


def build_second_prompt() -> str:
    return (
        "请把上一轮生成的作文概括为一段不超过 10 个中文汉字的摘要，"
        "并将摘要放入同一个 Structured Output 的 content 字段。"
    )


def build_third_prompt() -> str:
    return (
        "请基于上一轮摘要，为这篇作文写一句不超过 30 个中文汉字的宣传语，"
        "并将宣传语放入同一个 Structured Output 的 content 字段。"
    )


def build_fourth_prompt() -> str:
    return (
        "请基于上一轮宣传语，为这篇作文拟一个不超过 20 个中文汉字的短标题，"
        "并将标题放入同一个 Structured Output 的 content 字段。"
    )


def create_run_directory(
    output_directory: Path,
    *,
    run_id: str,
    started_at: datetime,
) -> Path:
    timestamp = started_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_directory = output_directory.resolve() / f"{timestamp}-{run_id}"
    run_directory.mkdir(parents=True, exist_ok=False)
    return run_directory


def write_new_json(path: Path, value: object) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def write_manifest(path: Path, manifest: Mapping[str, object]) -> None:
    temporary_path = path.with_suffix(".json.tmp")
    with temporary_path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
        file.write("\n")
    temporary_path.replace(path)


def dump_interaction(path: Path, interaction: Interaction) -> None:
    write_new_json(
        path,
        interaction.model_dump(mode="json", exclude_none=False),
    )


def parse_interaction(interaction: Interaction, *, round_name: str) -> DemoResponse:
    if interaction.status != "completed":
        raise RuntimeError(f"{round_name} ended with status: {interaction.status}.")
    if not interaction.output_text:
        raise RuntimeError(f"{round_name} did not return output text.")
    return DemoResponse.model_validate_json(interaction.output_text)


def usage_summary(interaction: Interaction) -> dict[str, int | None]:
    usage = interaction.usage
    return {
        "total_input_tokens": usage.total_input_tokens if usage is not None else None,
        "total_output_tokens": usage.total_output_tokens if usage is not None else None,
        "total_cached_tokens": usage.total_cached_tokens if usage is not None else None,
        "total_thought_tokens": usage.total_thought_tokens if usage is not None else None,
    }


def round_summary(
    interaction: Interaction,
    parsed: DemoResponse,
    *,
    result_file: Path,
) -> dict[str, object]:
    return {
        "interaction_id": interaction.id,
        "status": interaction.status,
        "content_characters": len(parsed.content),
        "content_sha256": content_fingerprint(parsed.content),
        "usage": usage_summary(interaction),
        "result_file": str(result_file.resolve()),
    }


def unparsed_round_summary(
    interaction: Interaction,
    *,
    result_file: Path,
) -> dict[str, object]:
    return {
        "interaction_id": interaction.id,
        "status": interaction.status,
        "usage": usage_summary(interaction),
        "result_file": str(result_file.resolve()),
    }


def cache_summary(
    previous_interaction: Interaction,
    current_interaction: Interaction,
) -> dict[str, object]:
    previous_usage = usage_summary(previous_interaction)
    current_usage = usage_summary(current_interaction)
    previous_input_tokens = previous_usage["total_input_tokens"]
    current_input_tokens = current_usage["total_input_tokens"]
    cached_tokens = current_usage["total_cached_tokens"]
    cache_ratio = (
        cached_tokens / current_input_tokens
        if cached_tokens is not None and current_input_tokens not in (None, 0)
        else None
    )
    return {
        "minimum_tokens": MIN_CACHE_TOKENS,
        "previous_input_tokens": previous_input_tokens,
        "precondition_met": (
            previous_input_tokens is not None
            and previous_input_tokens >= MIN_CACHE_TOKENS
        ),
        "hit": cached_tokens is not None and cached_tokens > 0,
        "cached_token_ratio": cache_ratio,
    }


def error_summary(error: Exception, *, api_key: str) -> dict[str, str]:
    message = str(error)
    if api_key:
        message = message.replace(api_key, "<redacted>")
    return {"type": type(error).__name__, "message": message}


def initial_manifest(
    config: DemoConfig,
    *,
    run_id: str,
    started_at: datetime,
    fingerprint: str,
    first_prompt: str,
) -> dict[str, object]:
    return {
        "run_id": run_id,
        "started_at": started_at.astimezone(UTC).isoformat(),
        "finished_at": None,
        "status": "running",
        "model": config.model,
        "parameters": {
            "essay_characters": config.essay_chars,
            "requested_first_prompt_characters": config.first_prompt_chars,
            "actual_first_prompt_characters": len(first_prompt),
            "first_prompt_sha256": content_fingerprint(first_prompt),
            "round_delay_seconds": config.round_delay_seconds,
            "topic": config.topic,
            "temperature": DEFAULT_TEMPERATURE,
            "thinking_level": DEFAULT_THINKING_LEVEL,
            "max_output_tokens": DEFAULT_MAX_OUTPUT_TOKENS,
            "minimum_cache_tokens": MIN_CACHE_TOKENS,
        },
        "contract_sha256": fingerprint,
        "rounds": {},
        "cache": None,
        "error": None,
    }


async def run_live_demo(
    config: DemoConfig,
    *,
    api_key: str,
    client_factory: Callable[..., Any] = genai.Client,
    run_id: str | None = None,
    started_at: datetime | None = None,
) -> DemoRunResult:
    resolved_run_id = run_id or str(uuid.uuid4())
    resolved_started_at = started_at or datetime.now(UTC)
    contract = build_contract(config)
    fingerprint = contract_fingerprint(contract)
    first_prompt = build_first_prompt(
        run_id=resolved_run_id,
        essay_chars=config.essay_chars,
        first_prompt_chars=config.first_prompt_chars,
        topic=config.topic,
    )
    run_directory = create_run_directory(
        config.output_directory,
        run_id=resolved_run_id,
        started_at=resolved_started_at,
    )
    manifest_path = run_directory / "manifest.json"
    manifest = initial_manifest(
        config,
        run_id=resolved_run_id,
        started_at=resolved_started_at,
        fingerprint=fingerprint,
        first_prompt=first_prompt,
    )
    write_manifest(manifest_path, manifest)

    client = client_factory(
        api_key=api_key,
        http_options={
            "base_url": GEMINI_BASE_URL,
            "async_client_args": {"verify": ssl.create_default_context()},
        },
    )
    first_interaction: Interaction | None = None
    second_interaction: Interaction | None = None
    third_interaction: Interaction | None = None
    fourth_interaction: Interaction | None = None
    try:
        first_contract_fingerprint = contract_fingerprint(contract)
        first_result = await client.aio.interactions.create(
            input=first_prompt,
            **contract,
        )
        if not isinstance(first_result, Interaction):
            raise RuntimeError("Round 1 did not return an Interaction.")
        first_interaction = first_result
        first_path = run_directory / "round-1-interaction.json"
        dump_interaction(first_path, first_interaction)
        first_parsed = parse_interaction(first_interaction, round_name="Round 1")
        manifest["rounds"]["round_1"] = round_summary(
            first_interaction,
            first_parsed,
            result_file=first_path,
        )
        write_manifest(manifest_path, manifest)

        if config.round_delay_seconds > 0:
            await asyncio.sleep(config.round_delay_seconds)
        second_contract_fingerprint = contract_fingerprint(contract)
        if first_contract_fingerprint != second_contract_fingerprint:
            raise RuntimeError("The request contract changed between rounds.")
        second_prompt = build_second_prompt()
        second_result = await client.aio.interactions.create(
            input=second_prompt,
            previous_interaction_id=first_interaction.id,
            **contract,
        )
        if not isinstance(second_result, Interaction):
            raise RuntimeError("Round 2 did not return an Interaction.")
        second_interaction = second_result
        second_path = run_directory / "round-2-interaction.json"
        dump_interaction(second_path, second_interaction)
        second_parsed = parse_interaction(second_interaction, round_name="Round 2")
        manifest["rounds"]["round_2"] = round_summary(
            second_interaction,
            second_parsed,
            result_file=second_path,
        )

        if config.round_delay_seconds > 0:
            await asyncio.sleep(config.round_delay_seconds)
        third_contract_fingerprint = contract_fingerprint(contract)
        if second_contract_fingerprint != third_contract_fingerprint:
            raise RuntimeError("The request contract changed between rounds.")
        third_result = await client.aio.interactions.create(
            input=build_third_prompt(),
            previous_interaction_id=second_interaction.id,
            **contract,
        )
        if not isinstance(third_result, Interaction):
            raise RuntimeError("Round 3 did not return an Interaction.")
        third_interaction = third_result
        third_path = run_directory / "round-3-interaction.json"
        dump_interaction(third_path, third_interaction)
        third_parsed = parse_interaction(third_interaction, round_name="Round 3")
        manifest["rounds"]["round_3"] = round_summary(
            third_interaction,
            third_parsed,
            result_file=third_path,
        )

        if config.round_delay_seconds > 0:
            await asyncio.sleep(config.round_delay_seconds)
        fourth_contract_fingerprint = contract_fingerprint(contract)
        if third_contract_fingerprint != fourth_contract_fingerprint:
            raise RuntimeError("The request contract changed between rounds.")
        fourth_result = await client.aio.interactions.create(
            input=build_fourth_prompt(),
            previous_interaction_id=third_interaction.id,
            **contract,
        )
        if not isinstance(fourth_result, Interaction):
            raise RuntimeError("Round 4 did not return an Interaction.")
        fourth_interaction = fourth_result
        fourth_path = run_directory / "round-4-interaction.json"
        dump_interaction(fourth_path, fourth_interaction)
        fourth_parsed = parse_interaction(fourth_interaction, round_name="Round 4")
        manifest["rounds"]["round_4"] = round_summary(
            fourth_interaction,
            fourth_parsed,
            result_file=fourth_path,
        )
        manifest["cache"] = {
            "round_2": cache_summary(first_interaction, second_interaction),
            "round_3": cache_summary(second_interaction, third_interaction),
            "round_4": cache_summary(third_interaction, fourth_interaction),
            "round_3_uses_round_2_parent": True,
            "round_4_uses_round_3_parent": True,
        }
        manifest["status"] = "completed"
        manifest["finished_at"] = datetime.now(UTC).isoformat()
        write_manifest(manifest_path, manifest)
        return DemoRunResult(run_directory=run_directory, succeeded=True)
    except Exception as error:  # noqa: BLE001 - provider failures must be persisted.
        manifest["status"] = "failed"
        manifest["finished_at"] = datetime.now(UTC).isoformat()
        manifest["error"] = error_summary(error, api_key=api_key)
        if first_interaction is not None and "round_1" not in manifest["rounds"]:
            manifest["rounds"]["round_1"] = unparsed_round_summary(
                first_interaction,
                result_file=run_directory / "round-1-interaction.json",
            )
        if second_interaction is not None and "round_2" not in manifest["rounds"]:
            manifest["rounds"]["round_2"] = unparsed_round_summary(
                second_interaction,
                result_file=run_directory / "round-2-interaction.json",
            )
        if third_interaction is not None and "round_3" not in manifest["rounds"]:
            manifest["rounds"]["round_3"] = unparsed_round_summary(
                third_interaction,
                result_file=run_directory / "round-3-interaction.json",
            )
        if fourth_interaction is not None and "round_4" not in manifest["rounds"]:
            manifest["rounds"]["round_4"] = unparsed_round_summary(
                fourth_interaction,
                result_file=run_directory / "round-4-interaction.json",
            )
        write_manifest(manifest_path, manifest)
        return DemoRunResult(run_directory=run_directory, succeeded=False)
    finally:
        with suppress(Exception):
            await client.aio.aclose()


def load_google_api_key() -> str:
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        dotenv_value = dotenv_values(REPOSITORY_ROOT / ".env").get("GOOGLE_API_KEY")
        api_key = str(dotenv_value or "").strip()
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is required when --execute is specified.")
    return api_key


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be greater than zero")
    return parsed


def non_negative_float(value: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be zero or greater")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="验证 Gemini Interactions 请求链的隐式缓存。",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--essay-chars", type=positive_integer, default=DEFAULT_ESSAY_CHARS)
    parser.add_argument(
        "--first-prompt-chars",
        type=positive_integer,
        default=DEFAULT_FIRST_PROMPT_CHARS,
    )
    parser.add_argument("--topic", default=DEFAULT_TOPIC)
    parser.add_argument(
        "--round-delay-seconds",
        type=non_negative_float,
        default=DEFAULT_ROUND_DELAY_SECONDS,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY,
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="实际调用 Gemini；省略时不会发起网络请求。",
    )
    return parser


def print_dry_run(config: DemoConfig) -> None:
    contract = build_contract(config)
    first_prompt = build_first_prompt(
        run_id="<dry-run>",
        essay_chars=config.essay_chars,
        first_prompt_chars=config.first_prompt_chars,
        topic=config.topic,
    )
    summary = {
        "mode": "dry-run",
        "network_request": False,
        "model": config.model,
        "essay_characters": config.essay_chars,
        "requested_first_prompt_characters": config.first_prompt_chars,
        "actual_first_prompt_characters": len(first_prompt),
        "round_delay_seconds": config.round_delay_seconds,
        "topic": config.topic,
        "system_instruction": SYSTEM_INSTRUCTION,
        "response_schema": contract["response_format"],
        "contract_sha256": contract_fingerprint(contract),
        "output_directory": str(config.output_directory.resolve()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def print_live_summary(result: DemoRunResult) -> None:
    manifest_path = result.run_directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output = {
        "status": manifest["status"],
        "manifest": str(manifest_path.resolve()),
        "round_1": manifest["rounds"].get("round_1"),
        "round_2": manifest["rounds"].get("round_2"),
        "round_3": manifest["rounds"].get("round_3"),
        "round_4": manifest["rounds"].get("round_4"),
        "cache": manifest["cache"],
        "error": manifest["error"],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = DemoConfig(
        model=args.model,
        essay_chars=args.essay_chars,
        first_prompt_chars=args.first_prompt_chars,
        round_delay_seconds=args.round_delay_seconds,
        topic=args.topic,
        output_directory=args.output_dir,
    )
    if not args.execute:
        print_dry_run(config)
        return 0

    try:
        api_key = load_google_api_key()
        result = asyncio.run(run_live_demo(config, api_key=api_key))
    except Exception as error:  # noqa: BLE001 - CLI must return a concise failure.
        print(f"Demo setup failed: {error}", file=sys.stderr)
        return 1
    print_live_summary(result)
    return 0 if result.succeeded else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
