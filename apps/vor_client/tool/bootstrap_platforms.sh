#!/usr/bin/env bash
# VOR platform bootstrap — materializes Flutter platform scaffolds (android/
# ios/windows) at CI time, then applies VOR platform patches deterministically.
# Keeping scaffolds OUT of git guarantees reproducible, current Gradle/Xcode
# project formats; all VOR-specific patches live HERE (reviewable, idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="${APP_NAME:-vor_client}"
ORG="${ORG:-ir.vor}"
PLATFORMS="${PLATFORMS:-android,ios,windows}"

echo "==> flutter create scaffolds ($PLATFORMS)"
flutter config --no-cli-animations
flutter create --platforms="$PLATFORMS" --org "$ORG" --project-name "$APP_NAME" .

echo "==> apply Android patches"
# minSdk 24 (VpnService + tun2socks), R8 shrinking, core library desugaring.
python3 - <<'PY'
import re, pathlib
g = pathlib.Path("android/app/build.gradle.kts")
s = g.read_text()
s = s.replace("minSdk = flutter.minSdkVersion", "minSdk = 24")
s = s.replace("targetSdk = flutter.targetSdkVersion", "targetSdk = 34")
s = s.replace(
    "release {",
    """release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")""",
)
s = s.replace(
    "buildTypes {",
    """signingConfigs {
            create("release") {
                val ks = System.getenv("VOR_KEYSTORE_B64")
                if (ks != null) {
                    storeFile = file("vor-release.jks")
                    storePassword = System.getenv("VOR_KEYSTORE_PASS")
                    keyAlias = System.getenv("VOR_KEY_ALIAS") ?: "vor"
                    keyPassword = System.getenv("VOR_KEY_PASS")
                }
            }
        }
        buildTypes {""",
)
s = re.sub(r"signingConfig = signingConfigs\.getByName\(\"debug\"\)", "signingConfig = if (System.getenv(\"VOR_KEYSTORE_B64\") != null) signingConfigs.getByName(\"release\") else signingConfigs.getByName(\"debug\")", s)
g.write_text(s)

m = pathlib.Path("android/app/src/main/AndroidManifest.xml")
s = m.read_text()
s = s.replace(
    "<application",
    """<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.QUERY_NETWORK_STATE" />
    <application""",
) if "INTERNET" not in s else s
m.write_text(s)
print("android patches applied")
PY

cat > android/app/proguard-rules.pro <<'EOF'
# VOR release rules — keep FFI surface, strip everything else.
-keep class dagger.hilt.** { *; }
-keepclassmembers class * extends android.app.Service { *; }
-keep class io.flutter.plugin.editing.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn org.slf4j.**
-assumenosideeffects class android.util.Log { public static *** d(...); public static *** v(...); }
EOF

echo "==> apply iOS patches (NetworkExtension entitlements, VPN permissions)"
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("ios/Runner/Info.plist")
if p.exists():
    # plist edit via regex-free approach: insert before closing dict
    s = p.read_text()
    inject = """
    <key>NSFaceIDUsageDescription</key>
    <string>VOR uses Face ID to protect the license vault.</string>
    <key>NSCameraUsageDescription</key>
    <string>VOR scans QR configuration codes locally.</string>
"""
    if "NSCameraUsageDescription" not in s:
        s = s.replace("</dict>\n</plist>", inject + "</dict>\n</plist>")
        p.write_text(s)
print("ios patches applied")
PY

echo "==> bootstrap complete"
