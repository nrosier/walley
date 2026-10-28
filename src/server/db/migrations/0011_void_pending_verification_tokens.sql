-- Issue 132: tokens issued under the password-gated regime are void under the link flow.
-- Users stay unverified and can register again.
DELETE FROM `email_verifications`;
