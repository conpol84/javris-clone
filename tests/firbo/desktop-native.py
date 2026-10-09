"""Real X11 input/capture acceptance on a synthetic Tk app, no model/network."""
import importlib.util
import pathlib
import subprocess
import tkinter as tk

source = pathlib.Path(__file__).resolve().parents[2] / "frontend/public/firbo-desktop.py"
spec = importlib.util.spec_from_file_location("desktop", source)
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)
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
try:
    frame = desktop.perform({"action": "observe"})
    assert frame["image"] and frame["width"] <= 1280
    desktop.perform({"action": "type", "text": "Μαζωνάκης Ώρες Μικρές"})
    root.update()
    assert entry.get() == "Μαζωνάκης Ώρες Μικρές", repr(entry.get())
    desktop.perform({"action": "key", "key": "Home"})
    root.update()
    desktop.perform({"action": "key", "key": "shift+End"})
    root.update()
    desktop.perform({"action": "type", "text": "verified native input"})
    root.update()
    assert entry.get() == "verified native input", repr(entry.get())
    x = round((button.winfo_rootx() + button.winfo_width() / 2) * frame["width"] / frame["screen_width"])
    y = round((button.winfo_rooty() + button.winfo_height() / 2) * frame["height"] / frame["screen_height"])
    desktop.perform({**frame, "action": "click", "x": x, "y": y})
    root.update()
    assert clicked == [True], clicked
    subprocess.run(["xdotool", "mousemove", "0", "0"], check=True)
    try:
        desktop.perform({"action": "type", "text": "must not type"})
    except ValueError as error:
        assert str(error) == "desktop_local_stop"
    else:
        raise AssertionError("Physical local stop was ignored")
    print("NATIVE_X11_CAPTURE_GREEK_KEYBOARD_CLICK_LOCAL_STOP_PASSED")
finally:
    root.destroy()
