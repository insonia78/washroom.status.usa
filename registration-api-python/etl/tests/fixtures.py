import json


def restroom(**changes):
    return {
        "id": 123, "name": "Public restroom", "latitude": 39.95, "longitude": -75.16,
        "accessible": True, "changing_table": False, "unisex": True,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-02-01T00:00:00Z",
        **changes,
    }


def archive(rows=None, **changes):
    return {
        "capturedAt": "2026-03-01T00:00:00Z", "provider": "refuge-restrooms",
        "request": {"method": "GET", "url": "https://www.refugerestrooms.org/api/v1/restrooms/by_location?lat=39.95"},
        "response": {"status": 200, "body": json.dumps([restroom()] if rows is None else rows)},
        **changes,
    }
