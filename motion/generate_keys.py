#!/usr/bin/env python3
"""
One-time VAPID key generation for Web Push notifications.

Usage:
    python generate_keys.py

This will print the public and private keys. Add them to config.py or
set them as VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY environment variables.
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
import base64
import os


def generate_vapid_keys():
    # Generate EC key pair (P-256 curve, required for VAPID)
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key = private_key.public_key()

    # Serialize private key as raw bytes (d value), URL-safe base64
    private_numbers = private_key.private_numbers()
    private_bytes = private_numbers.private_value.to_bytes(32, 'big')
    private_b64 = base64.urlsafe_b64encode(private_bytes).rstrip(b'=').decode('utf-8')

    # Serialize public key as uncompressed point (0x04 || x || y), URL-safe base64
    public_numbers = public_key.public_key().public_numbers() if hasattr(public_key, 'public_key') else public_key.public_numbers()
    x_bytes = public_numbers.x.to_bytes(32, 'big')
    y_bytes = public_numbers.y.to_bytes(32, 'big')
    public_bytes = b'\x04' + x_bytes + y_bytes
    public_b64 = base64.urlsafe_b64encode(public_bytes).rstrip(b'=').decode('utf-8')

    return private_b64, public_b64


if __name__ == '__main__':
    try:
        # Try pywebpush built-in key generation first (more reliable)
        from py_vapid import Vapid
        v = Vapid()
        v.generate_keys()
        private_b64 = v.private_pem().decode() if hasattr(v.private_pem(), 'decode') else v.private_pem()
        print("VAPID keys generated via py_vapid:\n")
        print(f"  Private key (PEM):\n{private_b64}\n")
        print(f"  Public key (Application Server Key):")
        print(f"  {v.public_key}\n")
        print("Add to config.py:")
        print(f'  VAPID_PRIVATE_KEY = "{private_b64.strip()}"')
        print(f'  VAPID_PUBLIC_KEY  = "{v.public_key}"')
    except ImportError:
        # Fallback to manual generation
        private_b64, public_b64 = generate_vapid_keys()
        print("VAPID keys generated:\n")
        print(f"  Private key: {private_b64}")
        print(f"  Public key:  {public_b64}\n")
        print("Add to config.py:")
        print(f'  VAPID_PRIVATE_KEY = "{private_b64}"')
        print(f'  VAPID_PUBLIC_KEY  = "{public_b64}"')
        print()
        print("Or set environment variables:")
        print(f'  export VAPID_PRIVATE_KEY="{private_b64}"')
        print(f'  export VAPID_PUBLIC_KEY="{public_b64}"')
