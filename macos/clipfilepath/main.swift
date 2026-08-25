import AppKit

// A Finder Cmd+C puts the file itself on the pasteboard (public.file-url) plus
// its icon, and no usable text. So a terminal paste yields nothing, and herdr's
// ctrl+v binding mistakes the icon for a screenshot and pastes a clip.png path.
//
// This watches the pasteboard and, on such a copy, re-publishes the same file
// URLs with a shell-ready POSIX path as the text flavor. Finder Cmd+V still
// copies the real file; the terminal now has something to paste.

let pb = NSPasteboard.general
var last = pb.changeCount

func shellQuote(_ s: String) -> String {
    if s.range(of: "^[A-Za-z0-9_@%+=:,./-]+$", options: .regularExpression) != nil {
        return s
    }
    return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

func fileURLs() -> [URL] {
    let opts: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    return pb.readObjects(forClasses: [NSURL.self], options: opts) as? [URL] ?? []
}

while true {
    let c = pb.changeCount
    if c != last {
        last = c
        let urls = fileURLs()
        if !urls.isEmpty {
            let text = urls.map { shellQuote($0.path) }.joined(separator: " ")
            let existing = pb.string(forType: .string)
            let names = Set(urls.map { $0.lastPathComponent })
            // Only touch a clipboard whose text is missing or is just the file
            // name(s) - never clobber a real text selection.
            let replaceable = existing.map { s in
                s.isEmpty || s.split(separator: "\n").allSatisfy { names.contains(String($0)) }
            } ?? true
            if replaceable && existing != text {
                let items: [NSPasteboardItem] = urls.enumerated().map { (i, u) in
                    let it = NSPasteboardItem()
                    it.setString(u.absoluteString, forType: .fileURL)
                    if i == 0 { it.setString(text, forType: .string) }
                    return it
                }
                pb.clearContents()
                pb.writeObjects(items)
                last = pb.changeCount
            }
        }
    }
    usleep(200_000)
}
