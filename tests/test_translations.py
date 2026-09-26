"""The NL/EN UI texts (translations.js) cover every text in index.html and every t() call in app.js."""

import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Texts that are the same in both languages (names, units, codes).
SAME_IN_BOTH = {
    'Bunq Financial Dashboard',
    'Bunq Financial Dashboard - Premium Analytics',
    'Trend',
    'Download',
    'NL', 'EN', 'Nederlands', 'English',
    'Bitwarden CLI',
    'OK',
    'N/A',
    'In:',
    ' · Impact {amount}',
    'width=device-width, initial-scale=1.0',
    'http://your-nas-ip:5000/api',
}


def _js_strings(source):
    """String literals ('...' or "...") of a JS source without comments, in order."""
    tokens = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        if source.startswith('//', i):
            i = source.find('\n', i)
            if i < 0:
                break
            continue
        if ch in ('"', "'"):
            quote = ch
            i += 1
            buf = []
            while i < n and source[i] != quote:
                if source[i] == '\\':
                    nxt = source[i + 1]
                    buf.append({'n': '\n', 't': '\t'}.get(nxt, nxt))
                    i += 2
                    continue
                buf.append(source[i])
                i += 1
            tokens.append(''.join(buf))
        i += 1
    return tokens


def _normalize(text):
    return ' '.join(text.split())


def _load_maps():
    source = (ROOT / 'translations.js').read_text(encoding='utf-8')
    split = source.index('}, {')
    maps = []
    for part in (source[:split], source[split:]):
        tokens = _js_strings(part)
        assert len(tokens) % 2 == 0, 'unbalanced key/value pairs in translations.js'
        maps.append({_normalize(tokens[i]): tokens[i + 1] for i in range(0, len(tokens), 2)})
    return maps


TO_EN, TO_NL = _load_maps()


def _known(text):
    key = _normalize(text)
    return key in TO_EN or key in TO_NL or key in SAME_IN_BOTH


def _t_call_literals(source):
    """String literals in the first argument of every t(...) call in app.js."""
    literals = []
    for match in re.finditer(r'(?<![\w.])t\(', source):
        depth = 0
        i = match.end() - 1
        start = match.end()
        end = None
        quote = None
        while i < len(source):
            ch = source[i]
            if quote:
                if ch == '\\':
                    i += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in ('"', "'", '`'):
                quote = ch
            elif ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
                if depth == 0:
                    end = end or i
                    break
            elif ch == ',' and depth == 1 and end is None:
                end = i
            i += 1
        first_arg = source[start:end]
        # Nested t(...) calls are checked on their own.
        first_arg = re.sub(r'(?<![\w.])t\([^()]*\)', '', first_arg)
        if '`' in first_arg:
            continue
        literals.extend(_js_strings(first_arg))
    return literals


def test_translation_placeholders_match():
    for table in (TO_EN, TO_NL):
        for key, value in table.items():
            key_names = set(re.findall(r'(?<!%)\{(\w+)\}', key))
            value_names = set(re.findall(r'(?<!%)\{(\w+)\}', value))
            assert key_names == value_names, (key, value)


def test_every_t_call_text_is_translated():
    source = (ROOT / 'app.js').read_text(encoding='utf-8')
    literals = _t_call_literals(source)
    assert len(literals) > 150
    missing = sorted({text for text in literals if not _known(text)})
    assert not missing, missing


def test_sunburst_share_texts_are_translated():
    for of in ('de inkomsten', 'de uitgaven', 'de categorie'):
        assert _known('{share} van ' + of)


# Elements translated as a whole (i18n.js, data-i18n-html): the key is their inner HTML.
_HTML_BLOCK = re.compile(r'<(li|p|span|summary)((?:\s[^>]*)?\sdata-i18n-html[^>]*)>(.*?)</\1>', re.S)


class _HtmlTexts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.texts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        for name, value in attrs:
            if name in ('title', 'placeholder', 'aria-label') and value and re.search('[A-Za-z]{2}', value):
                self.texts.append(value)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and re.search('[A-Za-z]{2}', data):
            self.texts.append(data)


def test_every_html_text_is_translated():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    blocks = [match.group(3) for match in _HTML_BLOCK.finditer(html)]
    assert blocks, 'expected data-i18n-html blocks in the admin panel'
    parser = _HtmlTexts()
    parser.feed(_HTML_BLOCK.sub('', html))
    missing = sorted({_normalize(text) for text in parser.texts + blocks if not _known(text)})
    assert not missing, missing


@pytest.mark.parametrize('category', [
    'Boodschappen', 'Horeca', 'Vervoer', 'Wonen', 'Energie & telecom', 'Abonnementen', 'Verzekering',
    'Belastingen', 'Kinderopvang', 'Alimentatie', 'Winkelen', 'Vrije tijd', 'Sport', 'Reizen', 'Zorg',
    'Salaris', 'Uitkeringen & toeslagen', 'Rente', 'Overig', 'Interne overboeking', 'Terugbetaling',
])
def test_categories_have_english_names(category):
    assert category in TO_EN
