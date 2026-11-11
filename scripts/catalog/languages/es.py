"""Spanish (books#56), written against the Gutenberg texts of docs/languages/es.md: chapters marked
CAPÍTULO PRIMERO, Tratado Segundo, PRIMERA PARTE, JORNADA, ACTO, or a bare Roman numeral (-I-,
--I--, I.); dialogue opened by a dash (— or Gutenberg's --), ¿…? and ¡…!, « » quotes; Sr. D. and
Vd. abbreviations."""
import re
import unicodedata

# ── Headings (fetch.py) ──

KIND = (r"(?:CAP[ÍI]TULO|Cap[íi]tulo|TRATADO|Tratado|PARTE|Parte|LIBRO|Libro|TOMO|Tomo|JORNADA|Jornada"
        r"|ACTO|Acto|ESCENA|Escena|CUADRO|Cuadro|CANTO|Canto|CARTA|Carta)")
ORDINAL = r"(?i:(?:primer|segund|tercer|cuart|quint|sext|s[eé]ptim|octav|noven|d[eé]cim)[oa]?)"
UNIT = r"(?i:uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|s[eé]ptim[oa]|octav[oa]|noven[oa])"
NUMTOK = rf"(?:[IVXLCDM]+|\d+|[^\W\d_]+(?:[- ](?:[yY] )?{UNIT})?)"  # "DÉCIMO TERCERO", "treinta y uno"
SEP = r"(?:\s*[.:—–-]\s*|\s+)"
SPECIAL = (r"(?:PR[ÓO]LOGO|Pr[óo]logo|EP[ÍI]LOGO|Ep[íi]logo|INTRODUCCI[ÓO]N|Introducci[óo]n|PREFACIO|Prefacio"
           r"|CONCLUSI[ÓO]N|Conclusi[óo]n|DEDICATORIA|Dedicatoria|ADVERTENCIA|Advertencia|PRELIMINAR|Preliminar)")
GENERIC = [  # (level, regex): 0 = book/part/act, 1 = chapter/scene, 2 = bare numeral
    (None, rf"(?P<kind>{KIND})\.?\s+(?P<num>{NUMTOK})\b\.?(?:{SEP}(?P<rest>.*))?"),
    (0, rf"(?P<num>{ORDINAL})\s+(?P<kind>PARTE|Parte|LIBRO|Libro|TOMO|Tomo|JORNADA|Jornada|ACTO|Acto)\.?(?:{SEP}(?P<rest>.*))?"),
    (2, r"[-—–]{1,2}\s*(?P<num>[IVXLC]+)\s*[-—–]{1,2}\.?"),  # -I-, --I--, — I —
    (2, rf"(?P<num>[IVX]|[IVXLC]{{2,}})\.?(?:{SEP}(?P<rest>[A-ZÁÉÍÓÚÑ¿¡«“‘\"'].*))?"),
    (1, rf"(?P<kind>{SPECIAL})\.?(?:{SEP}(?P<rest>.*))?"),
]
MAJOR = {"parte", "libro", "tomo", "jornada", "acto"}
ARTICLE = r"(?:EL|El|LA|La)\s+"
LAST = ("ÚLTIMO", "último")  # CAPÍTULO ÚLTIMO -> Capítulo último
LABEL = "Capítulo"
PART = "Parte"
BACK_MATTER = (r"(?i:notas?:?|notas del \w+|[íi]ndices?(?: general)?\.?|glosario|vocabulario|ap[ée]ndices?.*"
               r"|(?:fe de )?erratas\.?|nota del? transcri.*|fin(?: del? .*)?\.?"  # FIN, FIN DE LA NOVELA
               r"|end of (?:the )?project gutenberg.*)")  # the English footer of older Spanish files
EDITORIAL = (r"(?i:.*\b(?:traductor|editor|transcriptor|transcripci[óo]n)\b.*)"
             r"|(?:Introducci[óo]n|Pr[óo]logo|Prefacio|Advertencia|Estudio|Noticia).*\b(?:[Pp]or|POR) [A-ZÁÉÍÓÚÑ].*")
WRAPPED_TITLES = True  # "Capítulo II. Que trata de la primera salida que de su tierra hizo el / ingenioso don Quijote"
# Short lines are verse even when they start in lowercase, as most lines of Spanish verse do in
# modern editions ("Reposa aquí Dulcinea; / y, aunque de carnes rolliza,"); prose fills the line
VERSE_LOWER = 1.01
CONTENTS = r"(?i:[íi]ndice(?: general)?|tabla de materias|contenido)[.:]?"
BYLINE = r"(?:[Pp]or|POR) [A-ZÁÉÍÓÚÑ][\w.’'-]*(?:\s(?:[A-ZÁÉÍÓÚÑ][\w.’'-]*|de|del|y|DE|DEL|Y)){0,5}"
MARKUP = r"\[(?:Ilustraci[óo]n|[Ii]magen|Nota)[^\]]*\]"
BOLD_MARKUP = True  # Gutenberg's =bold= becomes plain text (Miau's "=Dios=", libros books#59)


def _plain(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


CARDINALS = {w: n for n, w in enumerate(
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis "
    "diecisiete dieciocho diecinueve veinte".split())} | {"un": 1, "una": 1}
CARD_TENS = {"treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90}
ORDINALS = {"primero": 1, "primer": 1, "segundo": 2, "tercero": 3, "tercer": 3, "tercio": 3, "cuarto": 4,
            "quinto": 5, "sexto": 6, "septimo": 7, "setimo": 7, "octavo": 8, "noveno": 9, "nono": 9,
            "decimo": 10, "undecimo": 11, "duodecimo": 12}
ORD_TENS = {"decimo": 10, "vigesimo": 20, "trigesimo": 30, "cuadragesimo": 40, "quincuagesimo": 50, "sexagesimo": 60}


def number_word(t: str) -> int | None:
    """A lowercased number word in a heading, with or without accents, either gender: 'primera',
    'décimo tercero', 'decimotercero', 'veintiuno', 'treinta y dos' -> 1, 13, 13, 21, 32."""
    t = _plain(t)
    ordinal = lambda w: ORDINALS.get(w) or ORDINALS.get(w[:-1] + "o") if w.endswith("a") else ORDINALS.get(w)
    if t in CARDINALS:
        return CARDINALS[t]
    if (n := ordinal(t)) or (n := CARD_TENS.get(t)) or (n := ORD_TENS.get(t) or ORD_TENS.get(t[:-1] + "o")):
        return n
    for prefix, tens in (("dieci", 10), ("veinti", 20)):
        if t.startswith(prefix) and 0 < CARDINALS.get(t[len(prefix):], 0) < 10:
            return tens + CARDINALS[t[len(prefix):]]
    m = re.fullmatch(r"(\w+?)[- ]?(?:y )?(\w+)", t)
    if m and m[1] in CARD_TENS and 0 < CARDINALS.get(m[2], 0) < 10:
        return CARD_TENS[m[1]] + CARDINALS[m[2]]
    for stem, tens in ORD_TENS.items():  # décimo tercero, vigésimaprimera
        for g in (stem, stem[:-1] + "a"):
            if t.startswith(g) and t != g and 0 < (ordinal(t[len(g):].lstrip(" -")) or 0) < 10:
                return tens + ordinal(t[len(g):].lstrip(" -"))
    return None


# Title case of ALL-CAPS headings: these words stay lowercase after the first, these all-caps
# words are not Roman numerals, and a capital follows these openers
SMALL = {"a", "al", "ante", "con", "contra", "de", "del", "desde", "e", "el", "en", "entre", "hacia", "hasta",
         "la", "las", "lo", "los", "o", "para", "por", "que", "se", "sin", "sobre", "su", "sus", "tras", "u",
         "un", "una", "unos", "unas", "y"}
NOT_ROMAN = ("CIVIL", "VIL")
OPENERS = "\"“‘'(\\[¿¡«"

# ── Sentences (segments.py) ──

LOWER = "a-záéíóúüñ"
# not before a lowercase word, nor before a dash that opens a lowercase dialogue tag: "—¿Venta es
# ésta? —replicó don Quijote." is one sentence
END = re.compile(rf"[.!?…]+[”’\"')\]»]*(?=\s+(?![{LOWER}]|[—-]+\s?[{LOWER}]))")
# A capital letter alone is an initial (D. Juan, V. M.)
ABBREVIATION = re.compile(r"\b(Sr|Sra|Srta|Sres|Srs|Dr|Dra|Dña|Ud|Uds|Vd|Vds|Vmd|Excmo|Excma|Ilmo|Ilma|Rvdo"
                          r"|Sto|Sta|Fr|Pbro|[A-ZÁÉÍÓÚÑ])$")

# ── Spoken titles (segments.py) ──

SPOKEN_KIND = (r"(?:Capítulo|Tratado|Parte|Libro|Tomo|Jornada|Acto|Escena|Cuadro|Canto|Carta|Rima|Leyenda"
               r"|Prólogo|Epílogo)")
FEMININE = {"parte", "jornada", "escena", "carta", "rima", "leyenda"}
SPOKEN_ORDINALS = ["", "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo", "octavo",
                   "noveno", "décimo"]
ONES = ("cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis "
        "diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco "
        "veintiséis veintisiete veintiocho veintinueve").split()
TENS_WORDS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos",
            "setecientos", "ochocientos", "novecientos"]


def words(n: int) -> str:
    """12 -> "doce", 365 -> "trescientos sesenta y cinco" (below 10,000)."""
    if n < 30:
        return ONES[n]
    if n < 100:
        return TENS_WORDS[n // 10] + (f" y {ONES[n % 10]}" if n % 10 else "")
    if n < 1000:
        return "cien" if n == 100 else HUNDREDS[n // 100] + (f" {words(n % 100)}" if n % 100 else "")
    return ("mil" if n < 2000 else f"{words(n // 1000)} mil") + (f" {words(n % 1000)}" if n % 1000 else "")


def spoken_number(kind: str, n: int) -> str:
    """How n is said after the heading word kind ("" for a numeral alone): an ordinal up to ten,
    agreeing with the heading ("Tratado segundo", "Parte primera"), else a cardinal ("Capítulo doce")."""
    if kind and 0 < n <= 10:
        word = SPOKEN_ORDINALS[n]
        return word[:-1] + "a" if kind.lower() in FEMININE else word
    return words(n)
