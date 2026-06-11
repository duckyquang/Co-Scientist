"""Apply per-request LLM credentials from browser headers (cloud mode)."""

from __future__ import annotations

from fastapi import HTTPException, Request

from ..config import Config, has_llm_key, provider_key_env

# Headers the React client sends when the user brings their own key.
HDR_PROVIDER = "X-LLM-Provider"
HDR_API_KEY = "X-API-Key"


def apply_user_credentials(base: Config, request: Request) -> Config:
    """Return a deep-copied Config with optional per-request provider + API key."""
    cfg = base.model_copy(deep=True)
    provider = (request.headers.get(HDR_PROVIDER) or "").strip().lower()
    api_key = (request.headers.get(HDR_API_KEY) or "").strip()

    if provider:
        cfg.llm.provider = provider
    if api_key:
        env_var = provider_key_env(cfg)
        if env_var:
            setattr(cfg.secrets, env_var, api_key)
        # OpenAI-compatible presets also honor OPENAI_API_KEY when set.
        if env_var and env_var != "OPENAI_API_KEY":
            openai_compat = {
                "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
                "TOGETHER_API_KEY", "MISTRAL_API_KEY",
            }
            if env_var in openai_compat:
                cfg.secrets.OPENAI_API_KEY = api_key

    return cfg


def require_llm_credentials(cfg: Config, *, allow_server_keys: bool = True) -> None:
    """Raise 401 if no API key is available for the active provider."""
    if has_llm_key(cfg):
        return
    if allow_server_keys:
        raise HTTPException(
            status_code=401,
            detail="No LLM API key configured. Add your key in Settings or set server env vars.",
        )
    raise HTTPException(status_code=401, detail="API key required for this provider.")
