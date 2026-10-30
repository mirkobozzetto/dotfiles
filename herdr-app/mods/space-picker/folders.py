"""List local folders, following directory symlinks; never invoke a shell."""
import json
import os
import sys
import signal
import time
import heapq
from itertools import count

EXCLUDED = {'node_modules', 'vendor', 'venv', '__pycache__', 'target', 'dist',
            'build', 'Pods', 'DerivedData', 'Library', 'Applications'}
CACHE_VERSION = 3
ARCHIVES = {'archive', 'archives', '_archive', 'vault', 'media', '_media'}


def timeout(_signal, _frame):
    raise TimeoutError('Folder scan timed out')


def directories(path):
    with os.scandir(path) as entries:
        result = []
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=True):
                    result.append(os.path.join(path, entry.name))
            except OSError:
                continue  # A disappeared entry or broken link must not hide its siblings.
        return sorted(result)


def build_index(roots, max_depth=3, max_entries=20000, max_seconds=4):
    """Bounded discovery, active folders before archives; follow links without cycles."""
    order = count()
    queue = [(0, 0, next(order), path) for path in dict.fromkeys(roots)]
    heapq.heapify(queue)
    paths, seen_paths, visited = [], set(), set()
    deadline = time.monotonic() + max_seconds
    limited = False
    name_bytes = 0
    try:
        while queue:
            if time.monotonic() >= deadline or len(paths) >= max_entries or name_bytes >= 4_000_000:
                limited = True
                break
            archived, depth, _, path = heapq.heappop(queue)
            try:
                metadata = os.stat(path)
                identity = (metadata.st_dev, metadata.st_ino)
                if identity in visited:
                    continue
                with os.scandir(path) as entries:
                    visited.add(identity)
                    if path not in seen_paths:
                        seen_paths.add(path)
                        paths.append(path)
                        name_bytes += len(path.encode('utf-8'))
                    for entry in entries:
                        if time.monotonic() >= deadline or len(paths) >= max_entries or name_bytes >= 4_000_000:
                            limited = True
                            break
                        if entry.name.startswith('.') or entry.name in EXCLUDED:
                            continue
                        try:
                            if not entry.is_dir(follow_symlinks=True):
                                continue
                        except OSError:
                            continue
                        child = os.path.join(path, entry.name)
                        if child not in seen_paths:
                            seen_paths.add(child)
                            paths.append(child)
                            name_bytes += len(child.encode('utf-8'))
                        if depth < max_depth - 1:
                            priority = archived or entry.name.lower() in ARCHIVES
                            heapq.heappush(queue, (int(priority), depth + 1, next(order), child))
                        else:
                            limited = True
            except TimeoutError:
                limited = True
                break
            except OSError:
                continue
    except TimeoutError:
        limited = True
    return {'paths': paths, 'limited': limited}


def folder_index(roots, cache_path=None, ttl=60):
    roots = list(dict.fromkeys(roots))
    if cache_path:
        try:
            with open(cache_path, encoding='utf-8') as cache:
                saved = json.load(cache)
            age = time.time() - saved['created']
            if (saved['version'] == CACHE_VERSION and saved['roots'] == roots
                    and 0 <= age < ttl):
                return saved['result']
        except (OSError, ValueError, KeyError, TypeError):
            pass
    result = build_index(roots)
    if cache_path:
        temporary = cache_path + '.tmp-' + str(os.getpid())
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(temporary, 'w', encoding='utf-8') as cache:
                json.dump({'version': CACHE_VERSION, 'created': time.time(),
                           'roots': roots, 'result': result}, cache)
            os.replace(temporary, cache_path)
        except OSError:
            pass  # Caching must not be required to search.
        finally:
            try:
                os.unlink(temporary)
            except OSError:
                pass
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit('Usage: folders.py DIRECTORY [check]')
    try:
        signal.signal(signal.SIGALRM, timeout)
        signal.alarm(5)
        path = sys.argv[1]
        mode = sys.argv[2] if len(sys.argv) > 2 else 'list'
        if mode == 'index':
            options = json.loads(sys.argv[3])
            print(json.dumps(folder_index(options['roots'], options.get('cache'), options.get('ttl', 60)), ensure_ascii=False))
        elif mode == 'check':
            with os.scandir(path):
                pass
            print(json.dumps(os.path.realpath(path)))
        else:
            print(json.dumps(directories(path)))
    except OSError:
        sys.exit(1)
