import json
from urllib.parse import quote, urlsplit

import httpx

BUCKET = "third-party-api-data-lake"
PREFIX = "refuge-restrooms"
MAX_BYTES = 10 * 1024 * 1024


class StorageError(RuntimeError):
    pass


class ArchiveStorage:
    def __init__(self, base_url: str, secret: str, transport=None):
        url = urlsplit(base_url)
        if url.scheme != "https" or not url.netloc or url.username or url.query or url.fragment:
            raise ValueError("SUPABASE_URL must be an HTTPS project URL")
        if not secret:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"), timeout=30, follow_redirects=False, transport=transport,
            headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
        )

    def close(self):
        self.client.close()

    def request(self, method: str, path: str, **kwargs):
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.HTTPError:
            raise StorageError("Storage network request failed") from None
        if not response.is_success:
            raise StorageError(f"Storage {method} returned HTTP {response.status_code}")
        return response

    def snapshot(self) -> list[str]:
        pending = [PREFIX]
        paths = []
        while pending:
            prefix = pending.pop()
            offset = 0
            while True:
                response = self.request("POST", f"/storage/v1/object/list/{BUCKET}", json={
                    "prefix": prefix, "limit": 1000, "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                })
                rows = response.json()
                if not isinstance(rows, list):
                    raise StorageError("Invalid Storage listing")
                for row in rows:
                    name = row.get("name") if isinstance(row, dict) else None
                    if not isinstance(name, str) or not name or "/" in name or name in (".", ".."):
                        raise StorageError("Invalid Storage object name")
                    path = f"{prefix}/{name}"
                    if row.get("id") is None:
                        pending.append(path)
                    elif name.endswith(".json"):
                        paths.append(path)
                if len(rows) < 1000:
                    break
                offset += len(rows)
        # Snapshot fully before deletion, so pagination cannot skip shifted objects.
        return sorted(set(paths))

    def download(self, path: str) -> object:
        self.validate_path(path)
        try:
            with self.client.stream("GET", f"/storage/v1/object/{BUCKET}/{quote(path, safe='/')}") as response:
                if not response.is_success:
                    raise StorageError(f"Storage GET returned HTTP {response.status_code}")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise StorageError("Archive exceeds 10 MiB")
                return json.loads(body)
        except httpx.HTTPError:
            raise StorageError("Storage download failed") from None

    def delete(self, path: str):
        self.validate_path(path)
        response = self.request("DELETE", f"/storage/v1/object/{BUCKET}", json={"prefixes": [path]})
        removed = response.json()
        if not isinstance(removed, list) or not any(
                isinstance(row, dict) and row.get("name") == path for row in removed):
            raise StorageError("Storage did not confirm archive deletion")

    @staticmethod
    def validate_path(path: str):
        if not path.startswith(f"{PREFIX}/") or any(part in ("", ".", "..") for part in path.split("/")):
            raise ValueError("Refusing to access an object outside the Refuge prefix")
