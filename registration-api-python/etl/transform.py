import json
import math
from datetime import datetime, timezone
from urllib.parse import urlsplit


def timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Missing timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def coordinate(value: object, limit: int) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > limit:
        raise ValueError("Invalid coordinates")
    return float(value)


def transform_archive(payload: object, cutoff: datetime) -> list[tuple]:
    if not isinstance(payload, dict) or payload.get("provider") != "refuge-restrooms":
        raise ValueError("Not a Refuge archive")
    captured = timestamp(payload.get("capturedAt"))
    if captured > cutoff:
        raise ValueError("Archive was captured after this run started")
    request = payload.get("request")
    response = payload.get("response")
    if not isinstance(request, dict) or not isinstance(response, dict) or payload.get("error"):
        raise ValueError("Incomplete or failed provider exchange")
    url = urlsplit(request.get("url", ""))
    if (url.scheme != "https" or url.hostname != "www.refugerestrooms.org"
            or url.path != "/api/v1/restrooms/by_location" or request.get("method") != "GET"):
        raise ValueError("Unexpected provider request")
    status = response.get("status")
    if type(status) is not int or not 200 <= status < 300 or not isinstance(response.get("body"), str):
        raise ValueError("Provider response was not successful")
    rows = json.loads(response["body"])
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError("Invalid provider response list")
    transformed = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid restroom record")
        identifier = row.get("id")
        if type(identifier) is not int or not 0 < identifier <= 9_007_199_254_740_991:
            raise ValueError("Invalid provider ID")
        name = row.get("name")
        if not isinstance(name, str) or "\x00" in name:
            raise ValueError("Invalid restroom name")
        for field in ("accessible", "changing_table", "unisex"):
            if type(row.get(field)) is not bool:
                raise ValueError(f"Invalid {field}")
        updated = timestamp(row.get("updated_at"))
        created = timestamp(row.get("created_at"))
        if created > updated or updated > captured:
            raise ValueError("Invalid provider timestamp order")
        transformed.append((
            identifier, name.strip() or "Refuge Restroom",
            coordinate(row.get("latitude"), 90), coordinate(row.get("longitude"), 180),
            "yes" if row["accessible"] else "no",
            "yes" if row["changing_table"] else "no", "yes" if row["unisex"] else "no",
            updated, captured,
        ))
    return transformed
