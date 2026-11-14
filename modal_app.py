
import modal

# ЕДИНСТВО | MEDIA STUDIO
# Облачный ИИ-сервер для автоматической синхронизации текста.

app = modal.App("edinstvo-media-studio-ai")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg",
        "libgomp1",
        "libsndfile1",
    )
    .pip_install(
        "fastapi>=0.115,<1",
        "python-multipart>=0.0.20",
        "python-dotenv>=1.0",
        "whisperx==3.8.6",
    )
    .add_local_python_source(
        "ai_server",
        "ai_limit",
        "telegram_auth",
    )
)


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("edinstvo-telegram"),
    ],
    cpu=2.0,
    memory=6144,
    timeout=600,
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
)
@modal.asgi_app()
def create_web_app():
    from ai_server import app as fastapi_app

    return fastapi_app
