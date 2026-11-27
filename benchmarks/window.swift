import CoreGraphics
import Foundation

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let text = String(data: data, encoding: .utf8) else {
    fputs("{\"visibility\":\"unknown\"}\n", stdout)
    return
  }
  print(text)
}

func area(_ window: [String: Any]) -> Double {
  guard let bounds = window[kCGWindowBounds] as? [String: Any] else { return 0 }
  let width = (bounds["Width"] as? NSNumber)?.doubleValue ?? 0
  let height = (bounds["Height"] as? NSNumber)?.doubleValue ?? 0
  return width * height
}

let arg = CommandLine.arguments.dropFirst().first ?? ""
if arg == "display" {
  var count: UInt32 = 0
  guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
    emit(["ready": false])
    exit(0)
  }
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  guard CGGetActiveDisplayList(count, &ids, &count) == .success, count > 0 else {
    emit(["ready": false])
    exit(0)
  }
  let bounds = CGDisplayBounds(ids[0])
  emit(["ready": true, "width": Int(bounds.width), "height": Int(bounds.height)])
  exit(0)
}

guard let pid = Int(arg) else {
  emit(["visibility": "unknown"])
  exit(0)
}
guard let raw = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
  emit(["visibility": "unknown"])
  exit(0)
}
let windows = raw.filter { window in
  (window[kCGWindowOwnerPID] as? NSNumber)?.intValue == pid && (window[kCGWindowLayer] as? NSNumber)?.intValue == 0
}
guard let window = windows.max(by: { area($0) < area($1) }), area(window) > 0,
      let bounds = window[kCGWindowBounds] as? [String: Any] else {
  emit(["visibility": "unknown"])
  exit(0)
}
guard let onscreen = window[kCGWindowIsOnscreen] as? NSNumber else {
  emit(["visibility": "unknown"])
  exit(0)
}
emit([
  "visibility": onscreen.boolValue ? "onscreen" : "offscreen",
  "x": (bounds["X"] as? NSNumber)?.intValue ?? 0,
  "y": (bounds["Y"] as? NSNumber)?.intValue ?? 0,
  "width": (bounds["Width"] as? NSNumber)?.intValue ?? 0,
  "height": (bounds["Height"] as? NSNumber)?.intValue ?? 0,
])
