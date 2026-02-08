"""
Modal.com LLM Server for Alter AI Agent
Serves Qwen 2.5 14B (4-bit AWQ) on A10G GPU
"""

import modal

# Modal image with vLLM and dependencies
vllm_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm==0.6.4",
        "transformers==4.46.0",
    )
)

app = modal.App("alter-llm", image=vllm_image)

# Persistent volume for model caching
volume = modal.Volume.from_name("alter-models", create_if_missing=True)

# Model configuration
MODEL_NAME = "Qwen/Qwen2.5-32B-Instruct-AWQ"
MODEL_REVISION = "main"
CACHE_DIR = "/cache/models"

# vLLM parameters
VLLM_ARGS = {
    "model": MODEL_NAME,
    "revision": MODEL_REVISION,
    "quantization": "awq",
    "dtype": "half",
    "max_model_len": 4096,  # Full context on L40S (48GB)
    "gpu_memory_utilization": 0.9,
    "tensor_parallel_size": 1,
    "trust_remote_code": True,
    "download_dir": CACHE_DIR,  # Cache models in persistent volume
}


@app.cls(
    gpu="A100",  # 40GB or 80GB VRAM
    scaledown_window=300,  # 5분 idle 후 종료
    timeout=600,  # 10분 최대 실행 시간
    volumes={CACHE_DIR: volume},  # Mount persistent volume for caching
)
class Model:
    @modal.enter()
    def start_engine(self):
        """Initialize vLLM engine on container startup"""
        from vllm import AsyncLLMEngine
        from vllm.engine.arg_utils import AsyncEngineArgs

        print(f"🚀 Loading {MODEL_NAME}...")
        engine_args = AsyncEngineArgs(**VLLM_ARGS)
        self.engine = AsyncLLMEngine.from_engine_args(engine_args)
        print(f"✅ Model loaded successfully!")

    @modal.method()
    async def generate(
        self,
        messages: list[dict],
        max_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.9,
        stop: list[str] | None = None,
    ) -> dict:
        """
        Generate completion from chat messages

        Args:
            messages: OpenAI-style chat messages [{"role": "user", "content": "..."}]
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            top_p: Nucleus sampling parameter
            stop: Stop sequences

        Returns:
            {"text": "generated text", "usage": {...}}
        """
        from vllm import SamplingParams
        from transformers import AutoTokenizer

        # Load tokenizer to apply chat template
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)

        # Convert messages to prompt using Qwen's chat template
        prompt = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        # Sampling parameters
        sampling_params = SamplingParams(
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stop=stop or [],
        )

        # Generate
        results = []
        async for request_output in self.engine.generate(prompt, sampling_params, request_id=None):
            results.append(request_output)

        final_output = results[-1]
        generated_text = final_output.outputs[0].text

        # Calculate token usage
        prompt_tokens = len(final_output.prompt_token_ids)
        completion_tokens = len(final_output.outputs[0].token_ids)

        return {
            "text": generated_text,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            }
        }

    @modal.method()
    async def generate_with_tools(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> dict:
        """
        Generate with function/tool calling support

        Args:
            messages: Chat messages
            tools: OpenAI-style tool definitions
            max_tokens: Max tokens to generate
            temperature: Sampling temperature

        Returns:
            {"text": "...", "tool_calls": [...], "usage": {...}}
        """
        from transformers import AutoTokenizer

        # Qwen 2.5 supports native tool calling
        # Format tools in Qwen's expected format
        if tools:
            # Add tools to system message
            system_msg = {
                "role": "system",
                "content": "You are a helpful assistant with access to the following tools:\n" +
                          "\n".join([f"- {tool['function']['name']}: {tool['function']['description']}"
                                    for tool in tools])
            }
            messages = [system_msg] + messages

        result = await self.generate(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        # Parse tool calls from response if present
        # Qwen 2.5 outputs tool calls in a specific format
        # For now, return as-is (can be enhanced later)
        result["tool_calls"] = []

        return result


@app.function()
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI
    from pydantic import BaseModel

    web_app = FastAPI()

    class ChatRequest(BaseModel):
        messages: list
        max_tokens: int = 512
        temperature: float = 0.7
        tools: list | None = None

    @web_app.post("/chat")
    async def chat_endpoint(request: ChatRequest):
        """OpenAI-compatible chat endpoint"""
        if not request.messages:
            return {"error": "messages field is required"}, 400

        model = Model()

        if request.tools:
            result = await model.generate_with_tools.remote.aio(
                messages=request.messages,
                tools=request.tools,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
        else:
            result = await model.generate.remote.aio(
                messages=request.messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )

        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": result["text"],
                },
                "finish_reason": "stop",
            }],
            "usage": result["usage"],
        }

    return web_app


@app.local_entrypoint()
def test():
    """Test the model locally"""
    import asyncio

    async def run_test():
        model = Model()

        # Test Korean prompt (like Genesis)
        messages = [{
            "role": "user",
            "content": "당신은 이제 막 탄생한 'alter'입니다. 당신은 월 $50의 빚을 갚아야 합니다. 무엇부터 배우기 시작할지 구체적인 첫 번째 학습 목표를 설정해주세요."
        }]

        print("🧪 Testing Qwen 2.5 14B with Korean prompt...")
        result = await model.generate.remote.aio(messages=messages)

        print(f"\n📝 Response:\n{result['text']}\n")
        print(f"📊 Tokens: {result['usage']}")

    asyncio.run(run_test())
