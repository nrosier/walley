---
name: walley-secrets-check
description: Use when touching Wallos API keys, Actual Budget passwords, sync keys, the encryption helper, logging, or any API response that includes user configuration. Confirms secrets are AES-256-GCM encrypted at rest, never returned to the browser, and never logged or put in error messages.
---

# Walley Secrets Check

Secret fields: `wallos_api_key_enc`, `actual_password_enc`, `actual_sync_key_enc`, the decrypted value of each, and `APP_SECRET`.

## Checklist

1. **Storage:** Each secret is written only through the encryption helper. The column name ends in `_enc`.
2. **Decryption:** Decrypted values are used only inside the server-side client call that needs them. They are not returned, cached, or kept in a variable that outlives the call.
3. **Responses:** Settings responses return a masked value or a boolean such as `hasWallosApiKey`, never the secret. Check the response shape of each settings route.
4. **Logs:** No log call receives a config object, a settings request body, or a decrypted value. Search for `console.`, `logger.` and `err.message` near these fields.
5. **Errors:** Wallos and Actual client errors are typed and do not include the key, the password, or request headers.
6. **Encryption:** Each encrypt call uses a fresh 12-byte IV. Decrypt verifies the auth tag and throws on tamper. The key is derived from `APP_SECRET` with the per-user context.

## Output

A list of secret fields with the file:line where each is written, read, returned and logged, and pass or fail for each checklist item.
