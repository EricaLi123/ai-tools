# 调用输出索引

本目录保存研究过程中全部真实调用结果。成功 Interaction JSON 均为 SDK 完整对象的 JSON 序列化结果，未裁剪 steps、usage 或模型输出。

| 目录 | 状态 | 内容 |
|---|---|---|
| `20260731T040900Z-5fc1b936-2e28-4475-8e9f-c28bbb2ec39b` | failed | 第一轮连接失败 manifest |
| `20260731T041152Z-8ddf2ece-52c1-45e5-be30-5ba1487d34a8` | failed | 第一轮连接失败 manifest |
| `20260731T041439Z-dd7db666-a013-4f09-b36e-ab8485d6a2d0` | completed | 两轮链完整结果 |
| `20260731T054022Z-3945a506-46db-4655-8859-3a17a6852e3f` | completed | 同 parent 分支三轮完整结果 |
| `20260731T055537Z-69c83f3a-1a92-4848-b978-d0a72bbb6650` | completed | 连续三轮完整结果 |
| `20260731T055558Z-0eb11115-1ca2-4e06-8988-689f0a6668c7` | running | 被中止进程留下的初始 manifest |
| `20260731T055652Z-f1da103a-5b47-4581-bc4c-bb4f0d72d461` | completed | 连续三轮重复实验 |
| `20260731T061639Z-b56dcf4a-3779-46a5-b2a4-b80555c08bc4` | completed | 6000 字四轮链，未达到观察门槛 |
| `20260731T061802Z-0a43b057-3dbc-4d35-b6f8-dfae90bd7975` | completed | 8000 字四轮链，第三、四轮部分命中 |
| `20260731T075720Z-70c8180f-33b0-47b4-a726-1796f67eb55f` | completed | 第一轮长 prompt 四轮链，第四轮命中 8112 tokens |
| `20260731T080612Z-96b2cb2e-693d-4b9f-b93c-b23e30d5381e` | completed | 长 prompt 四轮链，每轮等待 10 秒，所有轮次均未命中 |

`running` 目录不表示远端请求仍在运行。对应本地进程已被中止，该目录仅用于保留研究过程。
