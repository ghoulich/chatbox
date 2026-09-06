#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
android_jar=${ANDROID_PLATFORM_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
r8_jar=${R8_JAR:-/root/Downloads/chatbox/.tooling/r8-9.4.17.jar}
output_dir=${1:-"$script_dir/dex-out"}
libs_dir="$script_dir/libs"
stub_classes=$(mktemp -d /tmp/chatbox-network-stubs-XXXXXX)
plugin_classes=$(mktemp -d /tmp/chatbox-network-classes-XXXXXX)
plugin_jar=$(mktemp /tmp/chatbox-network-plugin-XXXXXX.jar)
mkdir -p "$libs_dir" "$output_dir"

download() {
  local url=$1
  local destination=$2
  if [[ ! -s "$destination" ]]; then
    curl --fail --location --max-time 180 "$url" --output "$destination"
  fi
}

download https://repo1.maven.org/maven2/dnsjava/dnsjava/3.6.4/dnsjava-3.6.4.jar "$libs_dir/dnsjava-3.6.4.jar"
download https://repo1.maven.org/maven2/com/hierynomus/sshj/0.40.0/sshj-0.40.0.jar "$libs_dir/sshj-0.40.0.jar"
download https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.jar "$libs_dir/slf4j-api-2.0.17.jar"
download https://repo1.maven.org/maven2/com/hierynomus/asn-one/0.6.0/asn-one-0.6.0.jar "$libs_dir/asn-one-0.6.0.jar"
download https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk18on/1.80/bcprov-jdk18on-1.80.jar "$libs_dir/bcprov-jdk18on-1.80.jar"
download https://repo1.maven.org/maven2/org/bouncycastle/bcpkix-jdk18on/1.80/bcpkix-jdk18on-1.80.jar "$libs_dir/bcpkix-jdk18on-1.80.jar"
download https://repo1.maven.org/maven2/org/bouncycastle/bcutil-jdk18on/1.80/bcutil-jdk18on-1.80.jar "$libs_dir/bcutil-jdk18on-1.80.jar"
download https://repo1.maven.org/maven2/org/snmp4j/snmp4j/3.9.6/snmp4j-3.9.6.jar "$libs_dir/snmp4j-3.9.6.jar"

find "$script_dir/compile-stubs" -name '*.java' -print0 | xargs -0 javac -source 8 -target 8 -cp "$android_jar" -d "$stub_classes"
javac -source 8 -target 8 -cp "$android_jar:$stub_classes:$libs_dir/*" -d "$plugin_classes" "$script_dir/NetworkToolsPlugin.java"
jar cf "$plugin_jar" -C "$plugin_classes" .
java -Xmx3g -cp "$r8_jar" com.android.tools.r8.D8 \
  --min-api 26 \
  --lib "$android_jar" \
  --output "$output_dir" \
  "$plugin_jar" "$libs_dir"/*.jar

echo "NetworkTools DEX written to $output_dir"
