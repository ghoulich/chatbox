#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
android_jar=${ANDROID_PLATFORM_JAR:-/root/Downloads/chatbox/.tooling/android-platform-35/android-35/android.jar}
r8_jar=${R8_JAR:-/root/Downloads/chatbox/.tooling/r8-9.4.17.jar}
output_dir=${1:-"$script_dir/document-saver-dex-out"}
stub_classes=$(mktemp -d /tmp/chatbox-document-saver-stubs-XXXXXX)
plugin_classes=$(mktemp -d /tmp/chatbox-document-saver-classes-XXXXXX)
plugin_jar=$(mktemp /tmp/chatbox-document-saver-plugin-XXXXXX.jar)
mkdir -p "$output_dir"

find "$script_dir/compile-stubs" -name '*.java' -print0 | xargs -0 javac -source 8 -target 8 -cp "$android_jar" -d "$stub_classes"
javac -source 8 -target 8 -cp "$android_jar:$stub_classes" -d "$plugin_classes" \
  "$script_dir/DocumentSaverPlugin.java"
jar cf "$plugin_jar" -C "$plugin_classes" .
java -Xmx1g -cp "$r8_jar" com.android.tools.r8.D8 \
  --min-api 23 \
  --lib "$android_jar" \
  --output "$output_dir" \
  "$plugin_jar"

echo "DocumentSaver DEX written to $output_dir"
