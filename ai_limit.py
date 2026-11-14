
from threading import BoundedSemaphore

# Only one AI synchronization task at a time.
ai_semaphore = BoundedSemaphore(value=1)


def acquire_ai_slot() -> bool:
    return ai_semaphore.acquire(blocking=False)


def release_ai_slot() -> None:
    ai_semaphore.release()
