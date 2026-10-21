# src/server/crypto

Encryption for per-user secrets: Wallos API keys, Actual Budget passwords and sync keys.

## Files

| Path | Exports | Read it when |
| --- | --- | --- |
| `secrets.ts` | `encryptSecret(plaintext, key)`, `decryptSecret(ciphertext, key)`, `DecryptError` | Storing or reading an encrypted secret |
| `keys.ts` | `deriveUserKey(appSecret, keySalt, userId)`, `newKeySalt()`, `KEY_SALT_BYTES` | Changing how a user's key is derived |
| `*.test.ts` | Tests, including the HKDF golden vector in `keys.test.ts` | Checking a change to either module |

## Design

- Secrets use AES-256-GCM with a random 12-byte IV per call and a 16-byte tag. The stored value is `v1:` followed by base64 of IV, tag and ciphertext. The `v1:` prefix leaves room for key rotation.
- Decryption rejects a wrong prefix, non-canonical base64, a value shorter than the IV and tag, and any failed authentication. Each failure throws `DecryptError` with a fixed message and no partial output.
- Each user's key is derived with HKDF-SHA256. APP_SECRET is the input key material, the user's random 32-byte `users.key_salt` is the salt, and the user id is the context.
- No error message contains a secret, a key, a salt or plaintext.

## Scanner note

`keys.test.ts` holds a public HKDF test vector. It is allowed past gitleaks by path in `.gitleaks.toml`, for the `generic-api-key` rule only.
