#!/bin/sh
set -e
cat > /usr/bin/tinyide <<'EOF'
#!/bin/sh
platform="${TINYIDE_OZONE_PLATFORM:-x11}"
executable="${TINYIDE_EXECUTABLE:-/opt/tinyIde/tinyide}"

case "$platform" in
  auto)
    exec "$executable" "$@"
    ;;
  wayland|x11)
    exec "$executable" --ozone-platform="$platform" "$@"
    ;;
  *)
    exec "$executable" --ozone-platform=x11 "$@"
    ;;
esac
EOF
chmod 0755 /usr/bin/tinyide
