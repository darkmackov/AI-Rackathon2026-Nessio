<!-- source: Zadani_ulohy.docx -->

RAKATHON 2026  ·  VÝZVA

Cesta pacienta bez ztráty informací – zadání úlohy

Všechna data jsou fiktivní a slouží výhradně pro potřeby Rakathonu.

Úkol

Využijte dostupnou dokumentaci a nasimulujte ve vaší aplikaci práci koordinátora KOC u pacienta - soutěžného případu. Aplikace z této dokumentace vytvoří Handover pro MDT (který se bude konat 21.10.2026) s informacemi dle souboru „Handover_obsah“. AI označí případné chybějící podklady. Aplikace též umožní doplnění těchto chybějících podkladů koordinátorem a jejich zapracování do handoveru. Zprávu z MDT aplikace zašle praktickému lékaři.

Podklady

Pacient– soutěžní případ (Alena Procházková): 13 zpráv z různých pracovišť (přehled viz níže)

Handover_obsah – seznam údajů, které má aplikace z dokumentace vytěžit, chybějící označit

MDT_zapis – seznam údajů, které jsou potřeba pro referování na MDT

MDT_zaver – vzorový zápis závěru MDT, kterou bude aplikace zasílat praktickému lékaři

Pacient – soutěžní případ

Pacientka byla vyšetřena primárně praktickým lékařem (PL) pro bolesti břicha a podezření na močovou infekci. Byly jí provedeny odběry a RTG plic a byla odeslána ke gastroenterologovi. S nálezem z ultrazvuku (UZ) břicha se vrátila k praktickému lékaři, který aktivoval koordinátora v komplexním onkologickém centru (KOC) 2 zasláním epikrízy (zpráva 07).

Koordinátor KOC 2:

vyžádal si všechny ostatní stávající zprávy (01-06),

objednal CT v KOC 1 (výsledek simuluje zpráva 08), protože v KOC 2 nebyl dostupný termín,

před MDT zajistil termín biopsie a kontrolních odběrů (zprávy 09-11),

objednal pacientku k algeziologovi a ke klinickému psychologovi (vyšetření proběhla po MDT, zprávy 12-13).

Dokumentace pochází z různých pracovišť a má různou podobu – od úplných zpráv po samotné výsledky vyšetření. Přehled dokumentace pacientky:

| # | Datum | Pracoviště | Dokument |
| --- | --- | --- | --- |
| 01 | 20. 7. 2026 | Kardiologická ambulance Jesenice | kontrola u kardiologa 3 měsíce před diagnózou |
| 02 | 1. 9. 2026 | Laboratoř LabJih | odběry PL: krevní obraz, biochemie, moč chemicky + sediment + kultivace |
| 03 | 3. 9. 2026 | Radiologické centrum Modřany | RTG plic (cestou PL) |
| 04 | 4. 9. 2026 | Praktický lékař, Dolní Břežany | epikríza PL, nasazení ATB, odeslání ke gastroenterologovi |
| 05 | 15. 9. 2026 | Poliklinika Jižní – gastroenterologie | vstupní vyšetření gastroenterologem |
| 06 | 29. 9. 2026 | Poliklinika Jižní – RDG | UZ břicha (cestou gastroenterologa) |
| 07 | 2. 10. 2026 | Praktický lékař, Dolní Břežany | epikríza a žádost PL o převzetí do péče KOC 2 (bez výsledků vyšetření) |
| 08 | 8. 10. 2026 | KOC 1 – Nemocnice Severní | výsledek CT břicha a hrudníku |
| 09 | 12. 10. 2026 | KOC 2 – Nemocnice Lipová, endoskopie | protokol o provedení biopsie (EUS-FNB) |
| 10 | 15. 10. 2026 | KOC 2 – Nemocnice Lipová, laboratoř | kontrolní odběry: krevní obraz, biochemie, nádorové markery |
| 11 | 19. 10. 2026 | KOC 2 – Nemocnice Lipová, patologie | výsledek biopsie |
| 12 | 26. 10. 2026 | KOC 1 – Nemocnice Severní, léčba bolesti | algeziologické vyšetření |
| 13 | 27. 10. 2026 | KOC 2 – Nemocnice Lipová, psychoonkologie | zpráva klinického psychologa |

Co má aplikace umět

Převzít: přijmout žádost PL o převzetí pacientky do péče KOC 2 a dokumentaci, kterou PL předává.

Vyžádat a shromáždit: umožnit koordinátorovi vyžádat chybějící zprávy z jiných pracovišť a mít všechny dokumenty pacientky na jednom místě.

Vytěžit: pomocí AI získat z dokumentace údaje dle souboru „Handover_obsah“ a upozornit na chybějící nebo nesouhlasící údaje.

Koordinovat: naplánovat a sledovat kroky pacientské cesty (CT v KOC 1, biopsie, kontrolní odběry, algeziolog, psycholog) s termínem, místem a stavem každého kroku.

Připravit podklad pro MDT: doplnit handover o vyšetření, které zařizoval koordinátor a připravit tak poklad pro MDT 21. 10. 2026 z údajů dostupných k tomuto datu.

Uzavřít smyčku: po MDT zaslat výsledek – MDT zprávu - praktickému lékaři, a doložit doručení.

Co odevzdáte

funkční demo celého průchodu pacientky v aplikaci

zprávu k jednání MDT vytvořenou aplikací dle obsahu dokumentu „MDT_zapis“

ukázku odeslání závěru MDT praktickému lékaři

Upozornění

Zprávy algeziologa a psychologa vznikly po MDT. Do zprávy pro MDT patří jen to, co bylo k 21. 10. 2026 známo.

Údaje z dokumentace přebírejte bez domýšlení; co v dokumentaci chybí, označte.
