#!/usr/bin/env python3
"""Owned guest-only native Device Hub driver. No host UI or app relaunch."""
import json
import signal

def stop_owned(signum, frame):
    raise SystemExit(130)
signal.signal(signal.SIGTERM, stop_owned)
import os
import pathlib
import subprocess
import time

MODE = os.environ["ARCADIA_DUO_MODE"]
DEVICE = os.environ["DUO_DEVICE_ID"]
ROOT = pathlib.Path(os.environ["ARCADIA_DUO_ROOT"])
OUT = ROOT / ("artifacts/fold-cycle-" + str(time.time_ns()))
OUT.mkdir(parents=True, exist_ok=True)
CONTROL = os.environ["ARCADIA_DUO_CONTROL"]
STARTED = time.time()
phases = []
print(str(OUT), flush=True)
video = None
desktop = None


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def protocol():
    data = command("xcrun", "simctl", "get_app_container", DEVICE,
                   "tokyo.drift.ArcadiaMobileUITests.xctrunner", "data")
    return pathlib.Path(data) / ("Documents/duo-real-59" if MODE == "real" else "Documents/duo-fold-59")


def wait_request(phase):
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            directory = protocol()
            request = directory / "request"
            if request.stat().st_mtime >= STARTED and request.read_text() == phase:
                return directory
        except (FileNotFoundError, subprocess.CalledProcessError):
            pass
        time.sleep(1)
    raise TimeoutError("No fresh public test request: " + phase)


try:
    if MODE == "real":
        directory = wait_request("journey")
    for phase, target in [("closed", 0), ("partial", 90), ("rotated", 90), ("open", 180)]:
        if MODE != "real":
            directory = wait_request(phase)
        display = "primary" if phase == "closed" else "primary-1"
        video_log = open(OUT / (phase + "-" + display + "-video.log"), "w")
        video = subprocess.Popen(["xcrun", "simctl", "io", DEVICE, "recordVideo", "--codec=h264", "--display=" + display, str(OUT / (phase + "-" + display + ".mp4"))], stderr=video_log)
        desktop = subprocess.Popen(["/usr/sbin/screencapture", "-v", "-V", "8", str(OUT / (phase + "-devicehub.mp4"))])
        command("/usr/bin/open", "/Applications/Xcode_27.1.app/Contents/Applications/DeviceHub.app")
        time.sleep(1)
        command(CONTROL, "option", "down")
        time.sleep(1)
        bounds = json.loads(command(CONTROL, "hinge-bounds"))
        # Native slider thumb radius from actual 16-point track height; endpoints
        # stay inside the measured track. Continuous drag commits the native pose.
        radius = bounds["height"] / 2 + 2
        left = bounds["x"] + radius
        right = bounds["x"] + bounds["width"] - radius
        start = float(bounds["value"])
        x0 = left + (right - left) * start / 180
        x1 = left + (right - left) * target / 180
        y = bounds["y"] + bounds["height"] / 2
        transition_start = time.time()
        command(CONTROL, "drag", str(x0), str(y), str(x1), str(y))
        command(CONTROL, "option", "up")
        if phase == "rotated":
            command(CONTROL, "press", "Rotate Right")
        transition_end = time.time()
        (OUT / (phase + "-transition.json")).write_text(json.dumps({"start": transition_start, "end": transition_end, "display": display}))
        phases.append({"name": phase, "start": transition_start, "end": transition_end})
        (directory / "native-phases.json").write_text(json.dumps(phases))
        (OUT / "native-phases.json").write_text(json.dumps(phases))
        time.sleep(3)
        command("/usr/bin/open", "/Applications/Xcode_27.1.app/Contents/Applications/DeviceHub.app")
        time.sleep(1)
        command(CONTROL, "option", "down")
        time.sleep(1)
        actual = json.loads(command(CONTROL, "hinge-bounds"))
        command(CONTROL, "option", "up")
        if abs(float(actual["value"]) - target) > 1:
            raise RuntimeError("Native pose did not commit: " + repr(actual))
        (OUT / (phase + "-pose.json")).write_text(json.dumps(actual, indent=2))
        (OUT / (phase + "-ax.txt")).write_text(command(CONTROL))
        (OUT / (phase + "-displays.txt")).write_text(command("xcrun", "simctl", "io", DEVICE, "enumerate"))
        (OUT / (phase + "-processes.txt")).write_text(command("ps", "-axo", "pid,command"))
        for display in ["primary", "primary-1"]:
            command("xcrun", "simctl", "io", DEVICE, "screenshot", "--display=" + display,
                    str(OUT / (phase + "-" + display + ".png")))
        video.send_signal(signal.SIGINT)
        if video.wait(timeout=15) != 0:
            raise RuntimeError("Actual simulator output recording failed")
        video = None
        video_log.close()
        if desktop.wait(timeout=15) != 0:
            raise RuntimeError("Native desktop recording failed; transition not acknowledged")
        command("/usr/sbin/screencapture", "-x", str(OUT / (phase + "-devicehub-settled.png")))
        (directory / (phase + ".complete")).write_text("Native pose committed and evidence saved")
    if MODE == "real":
        (directory / "poses.finished").write_text("All four actual native poses committed")
finally:
    if desktop is not None:
        try:
            desktop.wait(timeout=10)
        except subprocess.TimeoutExpired:
            desktop.terminate()
            try:
                desktop.wait(timeout=3)
            except subprocess.TimeoutExpired:
                desktop.kill()
                desktop.wait()
    if video is not None and video.poll() is None:
        video.send_signal(signal.SIGINT)
        try: video.wait(timeout=10)
        except subprocess.TimeoutExpired: video.kill(); video.wait()
    subprocess.run([CONTROL, "option", "up"], check=False)
