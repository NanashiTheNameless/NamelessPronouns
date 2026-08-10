#!/bin/sh
set -eu
SOURCE=${ENV_EXAMPLE:-.env.example}
DESTINATION=${ENV_OUTPUT:-.env}
if [ ! -f "$SOURCE" ]; then
  echo "Environment template not found: $SOURCE" >&2
  exit 1
fi
if [ -e "$DESTINATION" ]; then
  echo "Refusing to overwrite existing environment file: $DESTINATION" >&2
  exit 1
fi
for command_name in openssl awk mktemp chmod mv; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done
generate_value() {
  LEN=$1
  BYTES=$(( ((LEN + 3) / 4) * 3 ))
  openssl rand -base64 "$BYTES" | tr '+/' '-_' | tr -d '\n=' | head -c "$LEN"
}
COOKIE_SECRET=$(generate_value 64)
POLICY_COOKIE_SECRET=$(generate_value 64)
TOKEN_HASH_KEY=$(generate_value 64)
ALTCHA_HMAC_KEY=$(generate_value 64)
PASSWORD_PEPPER=$(generate_value 64)
TOTP_ENCRYPTION_KEY=$(generate_value 43)
CONTENT_FLAG_ENCRYPTION_KEY=$(generate_value 43)
BAN_ENCRYPTION_KEY=$(generate_value 43)
BACKUP_ENCRYPTION_KEY=$(generate_value 43)
POSTGRES_PASSWORD=$(generate_value 64)
temporary=$(mktemp "${DESTINATION}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
chmod 600 "$temporary"
awk \
  -v cookie="$COOKIE_SECRET" \
  -v policy="$POLICY_COOKIE_SECRET" \
  -v token_hash="$TOKEN_HASH_KEY" \
  -v altcha="$ALTCHA_HMAC_KEY" \
  -v pepper="$PASSWORD_PEPPER" \
  -v totp="$TOTP_ENCRYPTION_KEY" \
  -v content_flag="$CONTENT_FLAG_ENCRYPTION_KEY" \
  -v ban="$BAN_ENCRYPTION_KEY" \
  -v backup="$BACKUP_ENCRYPTION_KEY" \
  -v postgres_password="$POSTGRES_PASSWORD" '
  /^NODE_ENV=/ { print "NODE_ENV=production"; next }
  /^COOKIE_SECRET=/ { print "COOKIE_SECRET=" cookie; next }
  /^POLICY_COOKIE_SECRET=/ { print "POLICY_COOKIE_SECRET=" policy; next }
  /^TOKEN_HASH_KEY=/ { print "TOKEN_HASH_KEY=" token_hash; next }
  /^ALTCHA_HMAC_KEY=/ { print "ALTCHA_HMAC_KEY=" altcha; next }
  /^PASSWORD_PEPPER=/ { print "PASSWORD_PEPPER=" pepper; next }
  /^TOTP_ENCRYPTION_KEY=/ { print "TOTP_ENCRYPTION_KEY=" totp; next }
  /^CONTENT_FLAG_ENCRYPTION_KEY=/ { print "CONTENT_FLAG_ENCRYPTION_KEY=" content_flag; next }
  /^BAN_ENCRYPTION_KEY=/ { print "BAN_ENCRYPTION_KEY=" ban; next }
  /^BACKUP_ENCRYPTION_KEY=/ { print "BACKUP_ENCRYPTION_KEY=" backup; next }
  /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" postgres_password; next }
  /^DATABASE_URL=/ {
    print "DATABASE_URL=postgres://namelesspronouns:" postgres_password "@postgres:5432/namelesspronouns"
    next
  }
  { print }
' "$SOURCE" > "$temporary"
mv "$temporary" "$DESTINATION"
trap - EXIT HUP INT TERM
echo "Created production environment file $DESTINATION with unique secrets (mode 0600)."
echo "Replace the provider, hostname, and mailbox placeholders before deployment."
