from __future__ import annotations

import json
import ssl
from datetime import UTC, datetime
from pathlib import Path

import pytest
from google.genai.interactions import Interaction, ModelOutputStep, TextContent, Usage

import demo


def _interaction(
    interaction_id: str,
    content: str,
    *,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
    thought_tokens: int = 0,
) -> Interaction:
    return Interaction(
        id=interaction_id,
        status="completed",
        steps=[
            ModelOutputStep(
                content=[TextContent(text=json.dumps({"content": content}))]
            )
        ],
        usage=Usage(
            total_input_tokens=input_tokens,
            total_output_tokens=output_tokens,
            total_cached_tokens=cached_tokens,
            total_thought_tokens=thought_tokens,
        ),
    )


class _FakeInteractions:
    def __init__(self, results: list[Interaction | Exception]) -> None:
        self._results = iter(results)
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> Interaction:
        self.calls.append(kwargs)
        result = next(self._results)
        if isinstance(result, Exception):
            raise result
        return result


class _FakeAsyncClient:
    def __init__(self, interactions: _FakeInteractions) -> None:
        self.interactions = interactions
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class _FakeClient:
    def __init__(self, results: list[Interaction | Exception]) -> None:
        self.aio = _FakeAsyncClient(_FakeInteractions(results))


def _config(output_directory: Path) -> demo.DemoConfig:
    return demo.DemoConfig(
        model="gemini-test",
        essay_chars=6000,
        first_prompt_chars=8000,
        round_delay_seconds=0,
        topic="测试主题",
        output_directory=output_directory,
    )


def test_dry_run_does_not_create_output_directory(tmp_path, capsys) -> None:
    output_directory = tmp_path / "output"

    exit_code = demo.main(["--output-dir", str(output_directory)])

    assert exit_code == 0
    assert not output_directory.exists()
    result = json.loads(capsys.readouterr().out)
    assert result["network_request"] is False
    assert result["contract_sha256"]
    assert "api_key" not in result


def test_create_run_directory_refuses_to_overwrite(tmp_path) -> None:
    started_at = datetime(2026, 7, 31, 1, 2, 3, tzinfo=UTC)
    demo.create_run_directory(tmp_path, run_id="same", started_at=started_at)

    with pytest.raises(FileExistsError):
        demo.create_run_directory(tmp_path, run_id="same", started_at=started_at)


@pytest.mark.anyio
async def test_live_demo_saves_complete_interactions_and_reuses_contract(tmp_path) -> None:
    first = _interaction(
        "interaction-1",
        "长作文",
        input_tokens=5000,
        output_tokens=5000,
        cached_tokens=0,
    )
    second = _interaction(
        "interaction-2",
        "短摘要",
        input_tokens=5300,
        output_tokens=100,
        cached_tokens=4000,
    )
    third = _interaction(
        "interaction-3",
        "宣传语",
        input_tokens=5450,
        output_tokens=100,
        cached_tokens=4900,
        thought_tokens=12,
    )
    fourth = _interaction(
        "interaction-4",
        "短标题",
        input_tokens=5520,
        output_tokens=20,
        cached_tokens=5000,
    )
    client = _FakeClient([first, second, third, fourth])

    client_options: dict[str, object] = {}

    def client_factory(**kwargs: object) -> _FakeClient:
        client_options.update(kwargs)
        return client

    result = await demo.run_live_demo(
        _config(tmp_path),
        api_key="secret-key",
        client_factory=client_factory,
        run_id="run-test",
        started_at=datetime(2026, 7, 31, 1, 2, 3, tzinfo=UTC),
    )

    assert result.succeeded is True
    assert client.aio.closed is True
    assert client_options["api_key"] == "secret-key"
    assert client_options["http_options"]["base_url"] == demo.GEMINI_BASE_URL
    verify = client_options["http_options"]["async_client_args"]["verify"]
    assert isinstance(verify, ssl.SSLContext)
    assert verify.verify_mode == ssl.CERT_REQUIRED
    calls = client.aio.interactions.calls
    assert len(calls) == 4
    assert calls[0]["system_instruction"] == calls[1]["system_instruction"]
    assert calls[0]["response_format"] is calls[1]["response_format"]
    assert calls[0]["generation_config"] is calls[1]["generation_config"]
    assert calls[1]["previous_interaction_id"] == "interaction-1"
    assert calls[2]["previous_interaction_id"] == "interaction-2"
    assert calls[1]["input"] != calls[2]["input"]
    assert calls[0]["response_format"] is calls[2]["response_format"]
    assert calls[0]["generation_config"] is calls[2]["generation_config"]
    assert calls[3]["previous_interaction_id"] == "interaction-3"
    assert calls[2]["input"] != calls[3]["input"]
    assert calls[0]["response_format"] is calls[3]["response_format"]
    assert calls[0]["generation_config"] is calls[3]["generation_config"]
    assert "run_id: run-test" in calls[0]["input"]
    assert len(calls[0]["input"]) >= 8000

    first_file = result.run_directory / "round-1-interaction.json"
    second_file = result.run_directory / "round-2-interaction.json"
    third_file = result.run_directory / "round-3-interaction.json"
    fourth_file = result.run_directory / "round-4-interaction.json"
    assert json.loads(first_file.read_text(encoding="utf-8")) == first.model_dump(
        mode="json", exclude_none=False
    )
    assert json.loads(second_file.read_text(encoding="utf-8")) == second.model_dump(
        mode="json", exclude_none=False
    )
    assert json.loads(third_file.read_text(encoding="utf-8")) == third.model_dump(
        mode="json", exclude_none=False
    )
    assert json.loads(fourth_file.read_text(encoding="utf-8")) == fourth.model_dump(
        mode="json", exclude_none=False
    )
    manifest = json.loads(
        (result.run_directory / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["status"] == "completed"
    assert manifest["cache"]["round_2"]["hit"] is True
    assert manifest["cache"]["round_2"]["precondition_met"] is True
    assert manifest["parameters"]["actual_first_prompt_characters"] >= 8000
    assert manifest["cache"]["round_3"]["hit"] is True
    assert manifest["cache"]["round_4"]["hit"] is True
    assert manifest["cache"]["round_3_uses_round_2_parent"] is True
    assert manifest["cache"]["round_4_uses_round_3_parent"] is True
    assert manifest["rounds"]["round_3"]["usage"]["total_thought_tokens"] == 12
    assert "secret-key" not in json.dumps(manifest)


@pytest.mark.anyio
async def test_second_round_failure_keeps_first_result_and_writes_manifest(tmp_path) -> None:
    first = _interaction(
        "interaction-1",
        "长作文",
        input_tokens=100,
        output_tokens=5000,
        cached_tokens=0,
    )
    client = _FakeClient([first, RuntimeError("provider failed with secret-key")])

    result = await demo.run_live_demo(
        _config(tmp_path),
        api_key="secret-key",
        client_factory=lambda **_kwargs: client,
        run_id="run-failure",
        started_at=datetime(2026, 7, 31, 1, 2, 3, tzinfo=UTC),
    )

    assert result.succeeded is False
    assert (result.run_directory / "round-1-interaction.json").is_file()
    assert not (result.run_directory / "round-2-interaction.json").exists()
    manifest_text = (result.run_directory / "manifest.json").read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    assert manifest["status"] == "failed"
    assert manifest["rounds"]["round_1"]["interaction_id"] == "interaction-1"
    assert manifest["error"] == {
        "type": "RuntimeError",
        "message": "provider failed with <redacted>",
    }
    assert "secret-key" not in manifest_text


@pytest.mark.anyio
async def test_invalid_second_result_is_saved_before_schema_validation(tmp_path) -> None:
    first = _interaction(
        "interaction-1",
        "长作文",
        input_tokens=100,
        output_tokens=5000,
        cached_tokens=0,
    )
    invalid_second = Interaction(
        id="interaction-2",
        status="completed",
        steps=[ModelOutputStep(content=[TextContent(text="not-json")])],
        usage=Usage(
            total_input_tokens=5300,
            total_output_tokens=10,
            total_cached_tokens=4900,
        ),
    )
    client = _FakeClient([first, invalid_second])

    result = await demo.run_live_demo(
        _config(tmp_path),
        api_key="secret-key",
        client_factory=lambda **_kwargs: client,
        run_id="run-invalid",
        started_at=datetime(2026, 7, 31, 1, 2, 3, tzinfo=UTC),
    )

    second_file = result.run_directory / "round-2-interaction.json"
    manifest = json.loads(
        (result.run_directory / "manifest.json").read_text(encoding="utf-8")
    )
    assert result.succeeded is False
    assert second_file.is_file()
    assert manifest["rounds"]["round_2"]["interaction_id"] == "interaction-2"
    assert manifest["rounds"]["round_2"]["result_file"] == str(second_file.resolve())
    assert manifest["error"]["type"] == "ValidationError"
