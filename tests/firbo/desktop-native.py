"""Real X11 input/capture acceptance on a synthetic Tk app, no model/network."""

import concurrent.futures
import json
import pathlib
import subprocess
import time
import tkinter as tk

source = (
    pathlib.Path(__file__).resolve().parents[2] / "frontend/public/firbo-desktop.py"
)
root = tk.Tk()
root.geometry("500x240+60+60")
entry = tk.Entry(root, width=40)
entry.pack(pady=20)
clicked = []
button = tk.Button(root, text="Click me", command=lambda: clicked.append(True))
button.pack()
root.update()
entry.focus_force()
root.update()
subprocess.run(["xdotool", "mousemove", "40", "40"], check=True)
pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)


def perform(action):
    # The target application must keep processing X events while external input
    # arrives, just like a real independently running app. Blocking Tk during
    # xdotool's temporary Unicode key mapping loses non-ASCII key events.
    def invoke():
        # Exercise the actual Node supervisor -> Python adapter -> X11 chain.
        program = """
import {desktopAction} from './frontend/public/firbo-desktop.mjs';
let input=''; for await (const chunk of process.stdin) input+=chunk;
try { console.log(JSON.stringify(await desktopAction(JSON.parse(input)))); }
catch (error) { console.log(JSON.stringify({error:error.message})); }
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", program],
            input=json.dumps(action),
            text=True,
            capture_output=True,
            cwd=source.parents[2],
            timeout=120,
            check=True,
        )
        data = json.loads(result.stdout)
        if data.get("error"):
            raise ValueError(data["error"])
        return data

    future = pool.submit(invoke)
    while not future.done():
        root.update()
        time.sleep(0.001)
    root.update()
    return future.result()


try:
    frame = perform({"action": "observe"})
    assert frame["image"] and frame["width"] <= 1280
    for text in ["Μαζωνάκης Ώρες Μικρές"] * 5 + ["Ελληνικά ABC 123 " * 35]:
        entry.delete(0, tk.END)
        perform({"action": "type", "text": text})
        assert entry.get() == text, repr(entry.get())
    perform({"action": "key", "key": "Home"})
    root.update()
    perform({"action": "key", "key": "shift+End"})
    root.update()
    perform({"action": "type", "text": "verified native input"})
    root.update()
    assert entry.get() == "verified native input", repr(entry.get())
    x = round(
        (button.winfo_rootx() + button.winfo_width() / 2)
        * frame["width"]
        / frame["screen_width"]
    )
    y = round(
        (button.winfo_rooty() + button.winfo_height() / 2)
        * frame["height"]
        / frame["screen_height"]
    )
    perform({**frame, "action": "click", "x": x, "y": y})
    root.update()
    assert clicked == [True], clicked
    # Stop during a long input, not only before the first action.
    entry.delete(0, tk.END)
    entry.focus_force()
    root.after(
        200, lambda: subprocess.run(["xdotool", "mousemove", "0", "0"], check=True)
    )
    try:
        perform({"action": "type", "text": "Stop this input " * 30})
    except ValueError as error:
        assert str(error) == "desktop_local_stop"
        assert len(entry.get()) < 480
    else:
        raise AssertionError("Physical Stop during typing was ignored")
    try:
        perform({"action": "type", "text": "must not type"})
    except ValueError as error:
        assert str(error) == "desktop_local_stop"
    else:
        raise AssertionError("Physical local stop was ignored")
    print("NATIVE_X11_CAPTURE_GREEK_KEYBOARD_CLICK_LOCAL_STOP_PASSED")
finally:
    pool.shutdown(wait=True)
    root.destroy()
