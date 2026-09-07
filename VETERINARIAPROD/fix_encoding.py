#!/usr/bin/env python3
"""Fix mojibake: UTF-8 bytes that were read as cp1252/latin-1 and stored as UTF-8."""

import sys
import os

def char_to_byte(ch):
    """Convert a char back to its original byte (cp1252 first, latin-1 fallback)."""
    code = ord(ch)
    if code < 0x80:
        return code  # ASCII
    # Try cp1252 first (covers 0x80-0x9F Windows special chars)
    try:
        b = ch.encode('cp1252')
        return b[0]
    except (UnicodeEncodeError, IndexError):
        pass
    # Fallback: latin-1 covers 0xA0-0xFF and also undefined cp1252 positions
    # via direct code point (U+00xx -> byte 0xxx)
    if code <= 0xFF:
        return code
    return None


def fix_mojibake_pass(text):
    """Single pass: fix mojibake sequences in text."""
    result = []
    i = 0
    n = len(text)

    while i < n:
        ch = text[i]
        if ord(ch) < 0x80:
            # ASCII: can't be start of mojibake
            result.append(ch)
            i += 1
            continue

        # Non-ASCII: try sequences of length 8 down to 2
        fixed = False
        for length in range(8, 1, -1):
            end = i + length
            if end > n:
                continue
            segment = text[i:end]

            # All chars must be non-ASCII and mappable to a byte
            byte_arr = []
            ok = True
            for c in segment:
                if ord(c) < 0x80:
                    ok = False
                    break
                b = char_to_byte(c)
                if b is None:
                    ok = False
                    break
                byte_arr.append(b)

            if not ok:
                continue

            try:
                decoded = bytes(byte_arr).decode('utf-8')
                if decoded != segment:
                    result.append(decoded)
                    i = end
                    fixed = True
                    break
            except (UnicodeDecodeError, ValueError):
                pass

        if not fixed:
            result.append(ch)
            i += 1

    return ''.join(result)


def fix_all_passes(text, max_passes=4):
    """Run fix until stable (handles double/triple encoding)."""
    for _ in range(max_passes):
        new_text = fix_mojibake_pass(text)
        if new_text == text:
            break
        text = new_text
    return text


def fix_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            original = f.read()
    except Exception as e:
        print(f"ERROR reading {filepath}: {e}")
        return

    fixed = fix_all_passes(original)

    if fixed != original:
        with open(filepath, 'w', encoding='utf-8', newline='\n') as f:
            f.write(fixed)
        print(f"FIXED: {filepath}")
    else:
        print(f"  OK (no changes): {filepath}")


if __name__ == '__main__':
    files = sys.argv[1:]
    if not files:
        print("Usage: python fix_encoding.py <file1> <file2> ...")
        sys.exit(1)
    for fp in files:
        fix_file(fp)
