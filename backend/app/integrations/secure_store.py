"""Encrypt tokens at rest without adding a third-party dependency.

On Windows the token is sealed with DPAPI under the *current user* account, so another local
user (or a copy of the database file) cannot read it. There is deliberately no plaintext
fallback: refusing to save a token is safer than silently storing one in the clear.

Plaintext only exists in memory while a request is being served. No function here logs it and
no API response returns it.
"""

import base64
import ctypes
import ctypes.wintypes as wt
import sys

_PROTECT_FLAG = 0x4  # CRYPTPROTECT_UI_FORBIDDEN — a service must never pop a dialog.


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def available() -> bool:
    return sys.platform == "win32"


def _blob(data: bytes) -> tuple[_DATA_BLOB, ctypes.Array]:
    buf = ctypes.create_string_buffer(data)
    blob = _DATA_BLOB()
    blob.cbData = len(data)
    blob.pbData = ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte))
    return blob, buf


def _local_free(pointer) -> None:
    if not pointer:
        return
    kernel32 = ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    kernel32.LocalFree(ctypes.cast(pointer, ctypes.c_void_p))


def seal(text: str) -> str:
    """Return a base64 DPAPI blob, or '' when there is nothing to store."""
    if not text:
        return ""
    if not available():
        raise RuntimeError("Encrypted token storage is only available on Windows DPAPI")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt32.CryptProtectData.argtypes = [ctypes.POINTER(_DATA_BLOB), ctypes.c_wchar_p,
                                         ctypes.POINTER(_DATA_BLOB), ctypes.c_void_p,
                                         ctypes.c_void_p, wt.DWORD, ctypes.POINTER(_DATA_BLOB)]
    crypt32.CryptProtectData.restype = ctypes.c_int
    src, buf = _blob(text.encode("utf-8"))
    out = _DATA_BLOB()
    encrypted = b""
    try:
        if not crypt32.CryptProtectData(ctypes.byref(src), "AgentVille integration token",
                                        None, None, None, _PROTECT_FLAG, ctypes.byref(out)):
            raise RuntimeError("Windows DPAPI could not encrypt the token")
        encrypted = ctypes.string_at(out.pbData, out.cbData)
    finally:
        for i in range(len(buf)):
            buf[i] = 0
        _local_free(out.pbData)
    return base64.b64encode(encrypted).decode("ascii")


def unseal(value: str) -> str:
    """Decrypt a blob produced by `seal`. An empty value means 'no token'."""
    if not value:
        return ""
    if not available():
        raise RuntimeError("Encrypted token storage is only available on Windows DPAPI")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(_DATA_BLOB), ctypes.c_wchar_p,
                                           ctypes.POINTER(_DATA_BLOB), ctypes.c_void_p,
                                           ctypes.c_void_p, wt.DWORD, ctypes.POINTER(_DATA_BLOB)]
    crypt32.CryptUnprotectData.restype = ctypes.c_int
    raw = base64.b64decode(value)
    src, buf = _blob(raw)
    out = _DATA_BLOB()
    plain = b""
    try:
        if not crypt32.CryptUnprotectData(ctypes.byref(src), None, None, None, None,
                                          _PROTECT_FLAG, ctypes.byref(out)):
            raise RuntimeError("Token could not be decrypted on this Windows account")
        plain = ctypes.string_at(out.pbData, out.cbData)
    finally:
        for i in range(len(buf)):
            buf[i] = 0
        _local_free(out.pbData)
    return plain.decode("utf-8")
