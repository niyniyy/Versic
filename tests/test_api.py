
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)

FIXTURE = (
    Path(__file__).parent
    / "fixtures"
    / "c_major_scale.wav"
)


def test_health():

    r = client.get("/health")

    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_scale_notes_in_order():

    with FIXTURE.open("rb") as f:

        r = client.post(
            "/analyze",
            files={
                "file": (
                    "c_major_scale.wav",
                    f,
                    "audio/wav"
                )
            }
        )

    assert r.status_code == 200

    body = r.json()

    assert [n["name"] for n in body["notes"]] == [
        "C3", "D3", "E3", "F3",
        "G3", "A3", "B3", "C4"
    ]

    assert body["key_candidates"][0]["tonic"] == "C"

    assert body["spectrogram"]["rows"] > 100


def test_rejects_garbage_file():

    r = client.post(
        "/analyze",
        files={
            "file": (
                "bad.wav",
                b"this is not audio",
                "audio/wav"
            )
        }
    )

    assert r.status_code == 400
