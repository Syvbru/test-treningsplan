<script lang="ts">
    import { PUBLIC_CLOUDINARY_CLOUD_NAME, PUBLIC_CLOUDINARY_UPLOAD_PRESET } from '$env/static/public'
    import { tick } from "svelte";
    import Papa from "papaparse";
    import {
        parse, format, startOfDay, addDays, subDays, addMonths, subMonths,
        startOfMonth, endOfMonth, getDay, isSameDay, parseISO, isWithinInterval,
        startOfWeek, endOfWeek, addWeeks, subWeeks, addYears, subYears, getISOWeek,
    } from "date-fns";
    import { nb } from "date-fns/locale";
    import {
        Calendar, Clock, Zap, Dumbbell, BookOpen, Timer, Heart,
        BatteryCharging, User, Lock, ChevronDown, ChevronUp, Users,
        ChevronLeft, ChevronRight, X, LogOut, ArrowLeft, SquarePen,
        FileText, Video, NotepadText, LineChart, MessageSquare, Moon, Plus, Trash2
    } from "lucide-svelte";

    let username = "";
    let password = "";
    let loggedIn = false;
    let loginError = "";
    let isLoading = false;
    let isAdmin = false;
    let currentUtoverNavn = "";
    let currentEditPlanSheet = "";

    type ModalType = "session" | "calendar" | "profile" | "teknikk" | null;
    let activeModal: ModalType = null;
    let selectedSessionGroup: { date: string; sessions: Workout[] } | null = null;
    let selectedTeknikkLogg: TeknikkLogg | null = null;
    let showStyrkeSubmenu = false;
    let expandedDates = new Set<string>();
    let statPeriod: "uke" | "maaned" | "sesong" = "uke";
    let statAnchor: Date = startOfDay(new Date());
    let showStatDropdown = false;
    let showStatCalendar = false;
    let statCalendarCursor: Date = startOfMonth(new Date());
    let statCalendarDays: (Date | null)[] = [];
    let lineTooltip: { x: number; y: number; label: string; hours: number } | null = null;

    // ── BODY SCROLL LOCK ─────────────────────────────────────────────────────────
    $: if (typeof document !== 'undefined') {
        document.body.style.overflow = (activeModal || showStatCalendar) ? 'hidden' : '';
    }

    // ── SWIPE-TO-DISMISS ACTION ───────────────────────────────────────────────────
    function swipeToDismiss(node: HTMLElement) {
        let startY = 0;
        let deltaY = 0;

        function onStart(e: TouchEvent) {
            startY = e.touches[0].clientY;
            deltaY = 0;
            node.style.transition = 'none';
        }

        function onMove(e: TouchEvent) {
            deltaY = e.touches[0].clientY - startY;
            if (deltaY > 0 && node.scrollTop === 0) {
                e.preventDefault();
                node.style.transform = `translateY(${deltaY}px)`;
                node.style.opacity = `${1 - deltaY / 400}`;
            }
        }

        function onEnd() {
            node.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            if (deltaY > 100 && node.scrollTop === 0) {
                node.style.transform = `translateY(100%)`;
                node.style.opacity = '0';
                setTimeout(() => { activeModal = null; }, 220);
            } else {
                node.style.transform = '';
                node.style.opacity = '';
            }
            deltaY = 0;
        }

        node.addEventListener('touchstart', onStart, { passive: true });
        node.addEventListener('touchmove', onMove, { passive: false });
        node.addEventListener('touchend', onEnd, { passive: true });

        return {
            destroy() {
                node.removeEventListener('touchstart', onStart);
                node.removeEventListener('touchmove', onMove);
                node.removeEventListener('touchend', onEnd);
                document.body.style.overflow = '';
            }
        };
    }

    // ── SWIPE-TO-CLOSE (sidebar, sveip til høyre) ───────────────────────────────
    function swipeToClose(node: HTMLElement) {
        let startX = 0;
        let startY = 0;
        let deltaX = 0;
        let tracking = false;

        function onStart(e: TouchEvent) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            deltaX = 0;
            tracking = true;
            node.style.transition = 'none';
        }

        function onMove(e: TouchEvent) {
            if (!tracking) return;
            deltaX = e.touches[0].clientX - startX;
            const deltaY = e.touches[0].clientY - startY;
            // Only track horizontal swipe (not vertical scroll)
            if (Math.abs(deltaY) > Math.abs(deltaX) && deltaX < 10) {
                tracking = false;
                return;
            }
            if (deltaX > 0) {
                e.preventDefault();
                node.style.transform = `translateX(${deltaX}px)`;
                node.style.opacity = `${1 - deltaX / 400}`;
            }
        }

        function onEnd() {
            node.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            if (deltaX > 80) {
                node.style.transform = `translateX(100%)`;
                node.style.opacity = '0';
                setTimeout(() => { activeModal = null; showStyrkeSubmenu = false; }, 220);
            } else {
                node.style.transform = '';
                node.style.opacity = '';
            }
            deltaX = 0;
            tracking = false;
        }

        node.addEventListener('touchstart', onStart, { passive: true });
        node.addEventListener('touchmove', onMove, { passive: false });
        node.addEventListener('touchend', onEnd, { passive: true });

        return {
            destroy() {
                node.removeEventListener('touchstart', onStart);
                node.removeEventListener('touchmove', onMove);
                node.removeEventListener('touchend', onEnd);
            }
        };
    }

    // ── CARD SCROLL STATE ────────────────────────────────────────────────────────
    let cardScrollEl: HTMLElement | null = null;
    let cardAnchor: Date = startOfDay(new Date());
    let cardBackDays = 7;
    let cardForwardDays = 7;
    const CARD_W = 156; // w-36 (144px) + gap-3 (12px)
    
    function scrollToAnchor() {
        if (!cardScrollEl) return;
        const offset = window.innerWidth >= 700 ? 1 : 0;
        cardScrollEl.scrollLeft = (cardBackDays - offset) * CARD_W;
    }

    async function extendCardBack() {
        cardBackDays += 7;
        await tick();
        if (cardScrollEl) cardScrollEl.scrollLeft += (7 - 1) * CARD_W;
    }

    async function extendCardForward() {
        cardForwardDays += 7;
        await tick();
        if (cardScrollEl) cardScrollEl.scrollLeft += CARD_W;
    }

    let calendarModalCursor = startOfMonth(new Date());
    let calendarModalDays: (Date | null)[] = [];

    let fellesOkter: Array<{ dato: string; okt: string; utovere: string[] }> = [];

    type Workout = {
        date: string;
        title: string;
        durationMin?: number;
        description?: string;
    };

    let workouts: Workout[] = [];
    let today = startOfDay(new Date());
    let selectedDate: Date | null = null;

    if (typeof window !== "undefined") {
        isLoading = true;
        fetch('/api/verify')
            .then(res => res.json())
            .then(async (data) => {
                if (data.authenticated) {
                    loggedIn = true;
                    isAdmin = data.isAdmin;
                    username = data.username || "";
                    currentEditPlanSheet = data.editPlanSheet || "";
                    if (data.isAdmin) {
                        if (data.lastSearchName) {
                            currentUtoverNavn = data.lastSearchName;
                            await searchUtoverByName();
                        }
                    } else {
                        await Promise.all([loadWorkoutPlan(data.sheetUrl), loadFellesOkter(), hentTeknikk()]);
                        await tick(); scrollToAnchor();
                    }
                }
                isLoading = false;
            })
            .catch(() => { isLoading = false; });
    }

    async function handleLogin() {
        loginError = ""; isLoading = true;
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim().toLowerCase(), password })
            });
            const data = await res.json();
            if (data.success) {
                loggedIn = true; isAdmin = data.isAdmin; username = data.username;
                currentEditPlanSheet = data.editPlanSheet || "";
                if (!data.isAdmin) {
                    await Promise.all([loadWorkoutPlan(data.sheetUrl), loadFellesOkter(), hentTeknikk()]);
                    await tick(); scrollToAnchor();
                }
            } else { loginError = data.error || "Innlogging feilet."; }
        } catch { loginError = "Kunne ikke koble til server."; }
        finally { isLoading = false; }
    }

    async function searchUtoverByName() {
        const searchName = currentUtoverNavn.trim();
        if (!searchName) { loginError = "Skriv inn et navn"; return; }
        teknikkLogger = [];
        loginError = ""; isLoading = true;
        try {
            const res = await fetch('/api/admin-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ searchName })
            });
            const data = await res.json();
            if (data.success) {
                currentUtoverNavn = data.searchName;
                currentEditPlanSheet = data.editPlanSheet || "";
                await Promise.all([loadWorkoutPlan(data.sheetUrl), loadFellesOkter(), hentTeknikk()]);
                selectedDate = null; selectedSessionGroup = null;
                cardAnchor = startOfDay(new Date()); cardBackDays = 7; cardForwardDays = 7;
                await tick(); scrollToAnchor();
            } else { loginError = data.error || `Finner ingen: ${searchName}`; }
        } catch { loginError = "Kunne ikke koble til server."; }
        finally { isLoading = false; }
    }

    async function handleLogout() {
        try { await fetch('/api/logout', { method: 'POST' }); } catch {}
        loggedIn = false; username = ""; password = ""; loginError = "";
        isLoading = false; isAdmin = false; currentUtoverNavn = ""; currentEditPlanSheet = "";
        workouts = []; fellesOkter = []; expandedDates.clear();
        teknikkLogger = [];
        selectedDate = null; selectedSessionGroup = null; activeModal = null;
    }

    async function loadWorkoutPlan(sheetUrl: string) {
        try {
            const res = await fetch(sheetUrl);
            if (!res.ok) { loginError = "Kunne ikke laste regneark."; return; }
            const csvText = await res.text();
            Papa.parse(csvText, {
                header: false, skipEmptyLines: true,
                complete: (result) => {
                    const rows = result.data as string[][];
                    if (rows.length < 2) return;
                    const header = rows[0].map(h => h.trim().toLowerCase());
                    const parsed: Workout[] = [];
                    const iDato = header.findIndex(h => h.includes("dato"));
                    const iHva1 = header.findIndex(h => h.includes("hva økt 1"));
                    const iTid1 = header.findIndex(h => h === "tid");
                    const iHva2 = header.findIndex(h => h.includes("hva økt 2"));
                    const iTid2 = header.findIndex((h, i) => h === "tid" && i > iTid1);
                    const iKom = header.findIndex(h => h.includes("kommentar"));
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const dato = parseDate(row[iDato]);
                        const kom = iKom >= 0 ? (row[iKom]?.trim() ?? "") : "";
                        if (row[iHva1]) parsed.push({ date: dato, title: row[iHva1].trim(), durationMin: toMin(row[iTid1]), description: kom });
                        if (iHva2 >= 0 && row[iHva2]) parsed.push({ date: dato, title: row[iHva2].trim(), durationMin: toMin(iTid2 >= 0 ? row[iTid2] : ""), description: kom });
                    }
                    workouts = parsed.filter(w => w.date);
                }
            });
        } catch (e) { console.error("Feil:", e); }
    }

    async function loadFellesOkter() {
        try {
            const urlRes = await fetch('/api/felles-okter-url');
            const urlData = await urlRes.json();
            const res = await fetch(urlData.url);
            if (!res.ok) return;
            const csvText = await res.text();
            Papa.parse(csvText, {
                header: true, skipEmptyLines: true,
                complete: (result) => {
                    const rows = result.data as any[];
                    const parsed: typeof fellesOkter = [];
                    rows.forEach(row => {
                        const dato = row.Dato || row.dato || row.DATO;
                        const okt = row.Økt || row.økt || row.ØKT || row.Okt;
                        const utovere = row.Utøvere || row.utøvere || row.UTØVERE || row.Utovere;
                        if (dato && okt && utovere) {
                            const parsedDato = parseDate(dato);
                            const list = utovere.split(",").map((n: string) => n.trim()).filter((n: string) => n.length > 0);
                            if (parsedDato && list.length > 0) parsed.push({ dato: parsedDato, okt: okt.trim(), utovere: list });
                        }
                    });
                    fellesOkter = parsed;
                }
            });
        } catch (e) { console.error("Felles økt feil:", e); }
    }

    function toMin(t: string): number {
        if (!t) return 0;
        const [h, m] = t.split(":").map(x => parseInt(x) || 0);
        return h * 60 + m;
    }

    function formatTime(mins: number): string {
        if (!mins) return "";
        const h = Math.floor(mins / 60), m = mins % 60;
        if (h > 0 && m > 0) return `${h}t ${m}min`;
        if (h > 0) return `${h}t`;
        return `${m}min`;
    }

    function parseDate(str: string) {
        if (!str) return "";
        const clean = str.trim().toLowerCase();
        const parts = clean.split(".");
        if (parts.length >= 3) {
            const p = parse(`${parts[0].padStart(2,"0")}.${parts[1].padStart(2,"0")}.${parts[2].trim()}`, "dd.MM.yyyy", new Date(), { locale: nb });
            if (!isNaN(p.getTime())) return format(startOfDay(p), "yyyy-MM-dd");
        }
        const cY = new Date().getFullYear(), cM = new Date().getMonth();
        const cws = clean.replace(/(\d+)\.(\p{L}+)/u, "$1. $2");
        let p = parse(`${cws} ${cY}`, "d. MMMM yyyy", new Date(), { locale: nb });
        if (isNaN(p.getTime()) && parts.length >= 2)
            p = parse(`${parts[0].padStart(2,"0")}.${parts[1].padStart(2,"0")}.${cY}`, "dd.MM.yyyy", new Date(), { locale: nb });
        if (isNaN(p.getTime())) return "";
        const pm = p.getMonth();
        if (cM >= 4) { if (pm <= 3) p = new Date(cY + 1, pm, p.getDate()); }
        else { if (pm >= 4) p = new Date(cY - 1, pm, p.getDate()); }
        return format(startOfDay(p), "yyyy-MM-dd");
    }

    function endOfDayIncl(d: Date) { const e = new Date(d); e.setHours(23,59,59,999); return e; }

    // ── GETWORKOUTINFO ────────────────────────────────────────────────────────────
    // bg      = Tailwind-klasse for lys modus
    // darkBg  = hex-bakgrunnsfarge for mørk modus (kan tilpasses fritt her)
    // hexBg   = hex for lys modus (for eventuelle inline-stiler)
    // ─────────────────────────────────────────────────────────────────────────────
    function getWorkoutInfo(title: string, dark: boolean = false) {
        const lower = title.toLowerCase();
        const isHard = lower.includes("motbakkeløp") || lower.includes("sprint") || lower.includes("sprintøkt") || lower.includes("distanseøkt") || /(rennet|(?<!lang)renn(?!forbered))/u.test(lower) || lower.includes("dsv-cup") || lower.includes("km ") || lower.includes(" km") || lower.includes("birken") || lower.includes("klubbmesterskap") || lower.includes("skifestival") || lower.includes("vestmarka opp") || lower.includes("gjelleråsbakken") || lower.includes("askerspurten") || lower.includes("oslo marat") || lower.includes("terrengløp")|| lower.includes("10 for grete") || lower.includes("kong harald");
        if (lower.includes("intervall") || isHard)
            return { icon: Timer, color: "text-red-600", bg: "bg-red-100", hex: "#B91C1C", hexBg: "#FEF2F2", darkBg: "bg-red-500" };
        if (lower.includes("hvile"))
            return { icon: BatteryCharging, color: "text-green-600", bg: "bg-green-100", hex: "#15803D", hexBg: "#F0FDF4", darkBg: "bg-green-500" };
        if (lower.includes("langtur"))
            return { icon: Heart, color: "text-[#08BFB0]", bg: "bg-[#c2fffa]/70", hex: "#0F766E", hexBg: "#F0FDFA", darkBg: "bg-teal-400" };
        if (lower.includes("hurtighet"))
            return { icon: Zap, color: "text-[#A9D6E5]", bg: "bg-[#EBFAFF]/60", hex: "#0369A1", hexBg: "#F0F9FF", darkBg: "bg-sky-100" };
        if (lower.includes("teknikk"))
            return { icon: BookOpen, color: "text-[#A9D6E5]", bg: "bg-[#EBFAFF]/60", hex: "#0369A1", hexBg: "#F0F9FF", darkBg: "bg-sky-100" };
        if (lower.includes("styrke") || lower.includes("basis"))
            return { icon: Dumbbell, color: "text-yellow-600", bg: "bg-yellow-100", hex: "#A16207", hexBg: "#FEFCE8", darkBg: "bg-yellow-300" };
        if (lower.includes("rennforberedende"))
            return { icon: Heart, color: "text-[#A9D6E5]", bg: "bg-[#EBFAFF]/60", hex: "#0369A1", hexBg: "#F0F9FF", darkBg: "bg-sky-100" };
        return { icon: Heart, color: "text-[#A9D6E5]", bg: "bg-[#EBFAFF]/60", hex: "#0369A1", hexBg: "#F0F9FF", darkBg: "bg-sky-100" };
    }

    // Extract movement-form title from a workout name for the card heading
    const MOVEMENT_FORMS = ["klassisk", "skate", "skøyting", "staking", "styrke", "løp", "løping", "jogg", "jogging", "hvile", "sykkel", "skierg", "spinning", "mølle", "roing", "spenst", "mobilitet", "balanse", "stabilitet", "hyrox", "langkjøring", "elghufs", "skigang", "terrengsykkel", "landevei", "racer", "romaskin", "kajakk", "svømming", "tredemølle", "fotball", "volleyball", "innebandy", "basket", "tøying", "beveglighet", "koordinasjon", "hvile", "dans", "basis", "samling", "orientering", "friidrett", "skøyter"];
    function getCardTitle(title: string): string {
        const lower = title.toLowerCase();
        // Intervall overrides everything
        if (lower.includes("intervall")) return "Intervall";
        // Hurtighet and Styrke override movement form
        if (lower.includes("langtur")) return "Langtur";
        if (lower.includes("styrke")) return "Styrke";
        if (lower.includes("teknikk")) return "Teknikk";
        if (lower.includes("hurtighet")) return "Hurtighet";
        if (lower.includes("skiskole")) return "Skiskole";
        if (lower.includes("valgfri")) return "Valgfri";
        if (lower.includes("skiskyting")) return "Skiskyting";
        if (lower.includes("mat og helse")) return "M & H";
        if (lower.includes("overnatting")) return "Skoletur";
        if (lower.includes("idrettspesi") || lower.includes("idrettsspesi")) return "NTG langrenn";
        if (lower.includes("ntg") || lower.includes("idrettsspesi")) return "NTG-økt";
        if (lower.includes("tg1") || lower.includes("tg2") || lower.includes("tg3") || lower.includes("tg4") || lower.includes("tg5")) return "Teknikk";
        // Renn-logic
        const isTest = lower.includes("motbakkeløp") || lower.includes("sprintøkt") || lower.includes("distanseøkt");
        if (isTest) return "Test";
        const isRenn =  lower.includes("sprint") || /(rennet|(?<!lang)renn(?!forbered))/u.test(lower) || lower.includes("dsv-cup") || lower.includes("km ") || lower.includes(" km") || lower.includes("birken") || lower.includes("klubbmesterskap") || lower.includes("skifestival") || lower.includes("vestmarka opp") || lower.includes("gjelleråsbakken") || lower.includes("kong harald");
        if (isRenn) return "Renn";
        const isHardokt = lower.includes("oslo marat") || lower.includes("terrengløp") || lower.includes("10 for grete") || lower.includes("askerspurten");
        if (isHardokt) return "Hardøkt";
        for (const form of MOVEMENT_FORMS) {
            if (lower.includes(form)) {
                return form.charAt(0).toUpperCase() + form.slice(1);
            }
        }
        // Fallback: first word
        return title.split(" ")[0];
    }

    function getFellesUtovere(date: string, sessionTitle: string): string[] {
        const cur = isAdmin ? currentUtoverNavn.trim() : username.trim();
        if (!cur || !sessionTitle) return [];
        const matching = fellesOkter.filter(fo => fo.dato === date && fo.okt.toLowerCase() === sessionTitle.toLowerCase());
        const all = new Set<string>();
        matching.forEach(fo => {
            if (fo.utovere.some(u => u.toLowerCase() === cur.toLowerCase()))
                fo.utovere.forEach(u => { if (u.toLowerCase() !== cur.toLowerCase()) all.add(u); });
        });
        return Array.from(all).sort();
    }

    function groupByDate(list: Workout[]) {
        const map = new Map<string, Workout[]>();
        list.forEach(w => { if (!map.has(w.date)) map.set(w.date, []); map.get(w.date)!.push(w); });
        return Array.from(map.entries()).map(([date, sessions]) => ({ date, sessions }));
    }

    $: activeDate = selectedDate ?? today;
    $: activeIso = format(activeDate, "yyyy-MM-dd");
    $: currentWeekNum = getISOWeek(activeDate);
    $: {
        if (username.trim() && fellesOkter.length > 0 && loggedIn) {
            expandedDates = expandedDates;
        }
    }
    $: cardDays = Array.from(
        { length: cardBackDays + 1 + cardForwardDays },
        (_, i) => addDays(cardAnchor, i - cardBackDays)
    );
    // Reaktivt kart over antall felles utøvere per dag — avhenger direkte av fellesOkter
    // slik at kortene oppdateres når fellesOkter lastes inn asynkront
    $: fellesCountByDay = (() => {
        void fellesOkter; // tvinger Svelte til å tracke fellesOkter som avhengighet
        const result = new Map<string, number>();
        for (const day of cardDays) {
            const dayIso = format(day, "yyyy-MM-dd");
            const dw = workouts.filter(w => w.date === dayIso);
            if (dw.length > 0) {
                const f1 = getFellesUtovere(dayIso, dw[0]?.title ?? "");
                const f2 = dw.length >= 2 ? getFellesUtovere(dayIso, dw[1]?.title ?? "") : [];
                result.set(dayIso, new Set([...f1, ...f2]).size);
            }
        }
        return result;
    })();

    $: barStats = (() => {
        const t = statAnchor;
        const now = new Date();
        let pStart: Date, pEnd: Date;
        if (statPeriod === "uke") {
            pStart = startOfWeek(t, { weekStartsOn: 1 });
            pEnd = endOfWeek(t, { weekStartsOn: 1 });
        } else if (statPeriod === "maaned") {
            pStart = startOfMonth(t);
            pEnd = endOfMonth(t);
        } else {
            const isAfterMay = t.getMonth() >= 4;
            pStart = isAfterMay ? new Date(t.getFullYear(), 4, 1) : new Date(t.getFullYear() - 1, 4, 1);
            pEnd = isAfterMay ? new Date(t.getFullYear() + 1, 3, 30, 23,59,59) : new Date(t.getFullYear(), 3, 30, 23,59,59);
        }
        const sw = workouts.filter(w => { const d = parseISO(w.date); return d >= pStart && d <= pEnd; });
        let hard = 0, langtur = 0, styrke = 0, hvile = 0;
        sw.forEach(w => {
            const lower = w.title.toLowerCase();
            if (lower.includes("hvile")) hvile++;
            else if (lower.includes("styrke") || lower.includes("basis")) styrke++;
            else if (lower.includes("langtur")) langtur++;
            else {
                const isH = lower.includes("intervall") || lower.includes("motbakkeløp") || lower.includes("sprint") || lower.includes("distanseøkt") || /(rennet|(?<!lang)renn(?!forbered))/u.test(lower) || lower.includes("dsv-cup") || lower.includes("km ") || lower.includes(" km") || lower.includes("birken") || lower.includes("klubbmesterskap") || lower.includes("skifestival") || lower.includes("vestmarka opp") || lower.includes("gjelleråsbakken") || lower.includes("askerspurten") || lower.includes("oslo marat") || lower.includes("terrengløp") || lower.includes("10 for grete") || lower.includes("kong harald");
                if (isH) hard++;
            }
        });
        const totalMins = sw.reduce((s, w) => s + (w.durationMin || 0), 0);
        const totalSessions = sw.length - hvile;
        return {
            items: [
                { label: "Hardøkter", value: hard, barColor: "#FA1616" },
                { label: "Styrke", value: styrke, barColor: "#FABE19" },
                { label: "Langturer", value: langtur, barColor: "#1EBDB0" },
                { label: "Hvile", value: hvile, barColor: "#0BB02E" },
            ],
            total: totalSessions,
            totalHours: Math.floor(totalMins / 60),
            totalMins: totalMins % 60,
        };
    })();

    $: lineChartData = (() => {
        if (workouts.length === 0) return [];
        const t = statAnchor;
        const result: { label: string; hours: number }[] = [];

        if (statPeriod === "uke") {
            const weekStart = startOfWeek(t, { weekStartsOn: 1 });
            for (let i = 0; i < 7; i++) {
                const day = addDays(weekStart, i);
                const key = format(day, "yyyy-MM-dd");
                const mins = workouts.filter(w => w.date === key && w.durationMin).reduce((s, w) => s + (w.durationMin || 0), 0);
                result.push({ label: format(day, "EEE", { locale: nb }), hours: mins / 60 });
            }
        } else if (statPeriod === "maaned") {
            const mStart = startOfMonth(t);
            const mEnd = endOfMonth(t);
            let weekStart = startOfWeek(mStart, { weekStartsOn: 1 });
            while (weekStart <= mEnd) {
                const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
                // Use full week range for the chart — days outside the month are included
                const mins = workouts.filter(w => {
                    const d = parseISO(w.date);
                    return d >= weekStart && d <= wEnd && w.durationMin;
                }).reduce((s, w) => s + (w.durationMin || 0), 0);
                result.push({ label: `U${getISOWeek(weekStart)}`, hours: mins / 60 });
                weekStart = addWeeks(weekStart, 1);
            }
        } else {
            const isAfterMay = t.getMonth() >= 4;
            const sYear = isAfterMay ? t.getFullYear() : t.getFullYear() - 1;
            const addM = (year: number, month: number) => {
                const key = format(new Date(year, month, 1), 'yyyy-MM');
                const mins = workouts.filter(w => w.date.startsWith(key) && w.durationMin).reduce((s, w) => s + (w.durationMin || 0), 0);
                result.push({ label: format(new Date(year, month, 1), 'MMM', { locale: nb }), hours: mins / 60 });
            };
            for (let m = 4; m <= 11; m++) addM(sYear, m);
            for (let m = 0; m <= 3; m++) addM(sYear + 1, m);
        }
        return result;
    })();

    // Pre-computed chart values (avoids {@const} outside block elements)
    $: barMaxV = Math.max(...barStats.items.map(i => i.value), 1);
    $: barChartItems = barStats.items.map((item, idx) => {
        const bw = 36, gap = 20;
        const x = idx * (bw + gap) + 24;
        const bh = Math.max((item.value / barMaxV) * 70, 2);
        const y = 90 - bh;
        return { ...item, bw, x, bh, y };
    });

    $: lineMaxH = Math.max(...lineChartData.map(d => d.hours), 0.1);
    $: lineYTicks = (() => {
        const maxVal = Math.max(Math.ceil(lineMaxH), 1);
        const maxTicks = statPeriod === "uke" ? 6 : 4;
        // Find a "nice" step: smallest of [1,2,3,4,5,6,8,10,12,15,20,25,30] giving ≤ maxTicks ticks
        const candidates = [1,2,3,4,5,6,8,10,12,15,20,25,30,40,50];
        const step = candidates.find(s => Math.ceil(maxVal / s) <= maxTicks) ?? Math.ceil(maxVal / maxTicks);
        const top = Math.ceil(maxVal / step) * step;
        const ticks: number[] = [];
        for (let v = step; v <= top; v += step) ticks.push(v);
        return ticks;
    })();
    $: lineMaxCeil = lineYTicks[lineYTicks.length - 1] ?? 1;
    $: linePts = lineChartData.length > 1
        ? lineChartData.map((d, i) => ({
            x: (i / (lineChartData.length - 1)) * 224 + 30,
            y: 82 - (d.hours / lineMaxCeil) * 62,
            label: d.label,
            hours: d.hours
          }))
        : [];

    function fmtHours(h: number): string {
        const totalMin = Math.round(h * 60);
        const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
        if (hh > 0 && mm > 0) return `${hh}.${String(mm).padStart(2,"0")}`;
        if (hh > 0) return `${hh}`;
        return `${mm}m`;
    }

    function cloudinaryThumb(url: string): string {
        if (!url) return '';
        return url
            .replace('/video/upload/', '/video/upload/so_0,w_640/')
            .replace(/\.(mp4|mov|avi|webm|mkv)$/i, '.jpg');
    }

    $: linePoly = linePts.map(p => `${p.x},${p.y}`).join(" ");
    $: lineArea = linePts.length > 0
        ? `M ${linePts[0].x},88 ` + linePts.map(p => `L ${p.x},${p.y}`).join(" ") + ` L ${linePts[linePts.length-1].x},88 Z`
        : "";

    function openCalendarModal() {
        calendarModalCursor = startOfMonth(activeDate);
        updateCalendarModalDays();
        activeModal = "calendar";
    }
    function updateCalendarModalDays() {
        const ms = startOfMonth(calendarModalCursor), me = endOfMonth(calendarModalCursor);
        const sw = (getDay(ms) + 6) % 7;
        calendarModalDays = [];
        for (let i = 0; i < sw; i++) calendarModalDays.push(null);
        for (let d = 0; d < me.getDate(); d++) calendarModalDays.push(addDays(ms, d));
    }
    $: if (activeModal === "calendar") updateCalendarModalDays();

    async function selectCalendarDate(d: Date) {
        selectedDate = startOfDay(d);
        selectedSessionGroup = null;
        activeModal = null;
        cardAnchor = startOfDay(d);
        cardBackDays = 7;
        cardForwardDays = 7;
        await tick();
        if (cardScrollEl) {
            const offset = window.innerWidth > 700 ? 1 : 0;
            cardScrollEl.scrollLeft = (cardBackDays - offset) * CARD_W;
        }
    }

    function setPeriod(val: string) {
        statPeriod = val as "uke" | "maaned" | "sesong";
        statAnchor = startOfDay(new Date());
        showStatDropdown = false;
    }

    function prevStatPeriod() {
        if (statPeriod === "uke") statAnchor = subWeeks(statAnchor, 1);
        else if (statPeriod === "maaned") statAnchor = subMonths(statAnchor, 1);
        else statAnchor = subYears(statAnchor, 1);
    }

    function nextStatPeriod() {
        if (statPeriod === "uke") statAnchor = addWeeks(statAnchor, 1);
        else if (statPeriod === "maaned") statAnchor = addMonths(statAnchor, 1);
        else statAnchor = addYears(statAnchor, 1);
    }

    $: statPeriodLabel = (() => {
        const t = statAnchor;
        if (statPeriod === "uke") return `Uke ${getISOWeek(t)}`;
        if (statPeriod === "maaned") return format(t, "MMMM yyyy", { locale: nb });
        const isAfterMay = t.getMonth() >= 4;
        const sYear = isAfterMay ? t.getFullYear() : t.getFullYear() - 1;
        return `Sesong ${sYear}/${sYear + 1}`;
    })();

    function openStatCalendar() {
        statCalendarCursor = startOfMonth(statAnchor);
        updateStatCalendarDays();
        showStatCalendar = true;
        showStatDropdown = false;
    }
    function updateStatCalendarDays() {
        const ms = startOfMonth(statCalendarCursor), me = endOfMonth(statCalendarCursor);
        const sw = (getDay(ms) + 6) % 7;
        statCalendarDays = [];
        for (let i = 0; i < sw; i++) statCalendarDays.push(null);
        for (let d = 0; d < me.getDate(); d++) statCalendarDays.push(addDays(ms, d));
    }
    function selectStatCalendarDate(d: Date) {
        statAnchor = startOfDay(d);
        showStatCalendar = false;
    }

    function openSessionDetail(date: string, sessions: Workout[]) {
        selectedDate = parseISO(date);
        selectedSessionGroup = { date, sessions };
        activeModal = "session";
    }

    const styrkeProgrammer = [
        { title: "Styrke med vekter", url: "/pdf/StyrkeMedVekter.pdf" },
        { title: "Styrke uten vekter", url: "/pdf/StyrkeUtenVekter.pdf" },
        { title: "Styrke vinter", url: "/pdf/StyrkeVinter.pdf" },
        { title: "Kort styrkeøkt overkropp", url: "/pdf/KortStyrkeøktOverkropp.pdf" },
        { title: "Kort styrkeøkt ben", url: "/pdf/KortStyrkeøktBen.pdf" },
    ];

    // ── DARK MODE
    let darkMode = typeof localStorage !== 'undefined' && localStorage.getItem('dk') !== '0';
    $: typeof localStorage !== 'undefined' && localStorage.setItem('dk', darkMode ? '1' : '0');

    // ── YOUTUBE FACADE ───────────────────────────────────────────────────────────
    let activeVideos = new Set<string>();
    function activateVideo(id: string) {
        activeVideos = new Set([...activeVideos, id]);
    }
    // ── SLUTT: YOUTUBE FACADE ────────────────────────────────────────────────────

    // ── TEKNIKKLOGG ──────────────────────────────────────────────────────────────
    type TeknikkLogg = {
        id: number;
        dato: string;
        stilart: string;
        tilbakemelding: string;
        video_urls: string[];
    };
    
    let teknikkLogger: TeknikkLogg[] = [];
    let teknikkDato = '';
    let teknikkStilart = '';
    let teknikkTilbakemelding = '';
    let teknikkVideoFiler: File[] = [];
    let uploadProgressList: number[] = [];
    let teknikkLaster = false;
    let teknikkFeil = '';
    let visTeknikkSkjema = false;
    let uploadProgress = 0;
    
    async function hentTeknikk() {
        try {
            const res = await fetch('/api/teknikk');
            if (res.ok) {
                const data = await res.json();
                teknikkLogger = data.map((logg: any) => ({
                    ...logg,
                    video_urls: Array.isArray(logg.video_urls) ? logg.video_urls : []
                }));
            }
        } catch {}
    }
        
    function uploadTilCloudinary(fil: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('file', fil);
            fd.append('upload_preset', PUBLIC_CLOUDINARY_UPLOAD_PRESET);
    
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `https://api.cloudinary.com/v1_1/${PUBLIC_CLOUDINARY_CLOUD_NAME}/video/upload`);
    
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) uploadProgress = Math.round((e.loaded / e.total) * 100);
            };
    
            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.responseText).secure_url);
                } else {
                    reject(new Error('Cloudinary feil'));
                }
            };
    
            xhr.onerror = () => reject(new Error('Nettverksfeil'));
            xhr.send(fd);
        });
    }
    
    async function lagreTeknikklogg() {
        if (!teknikkDato || !teknikkStilart) return;
        teknikkLaster = true;
        teknikkFeil = '';
        uploadProgressList = teknikkVideoFiler.map(() => 0);

        try {
            const video_urls: string[] = [];
            const totalBytes = teknikkVideoFiler.reduce((s, f) => s + f.size, 0);
            const loadedPerFile = new Array(teknikkVideoFiler.length).fill(0);

            for (let i = 0; i < teknikkVideoFiler.length; i++) {
                const url = await new Promise<string>((resolve, reject) => {
                    const fd = new FormData();
                    fd.append('file', teknikkVideoFiler[i]);
                    fd.append('upload_preset', PUBLIC_CLOUDINARY_UPLOAD_PRESET);
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `https://api.cloudinary.com/v1_1/${PUBLIC_CLOUDINARY_CLOUD_NAME}/video/upload`);
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            loadedPerFile[i] = e.loaded;
                            const totalLoaded = loadedPerFile.reduce((s, b) => s + b, 0);
                            uploadProgress = Math.round((totalLoaded / totalBytes) * 100);
                        }
                    };
                    xhr.onload = () => xhr.status === 200
                        ? resolve(JSON.parse(xhr.responseText).secure_url)
                        : reject(new Error(`Cloudinary: ${JSON.parse(xhr.responseText)?.error?.message ?? xhr.status}`));
                    xhr.onerror = () => reject(new Error('Nettverksfeil'));
                    xhr.send(fd);
                });
                video_urls.push(url);
            }

            const res = await fetch('/api/teknikk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dato: teknikkDato, stilart: teknikkStilart, tilbakemelding: teknikkTilbakemelding, video_urls })
            });

            if (res.ok) {
                teknikkDato = ''; teknikkStilart = ''; teknikkTilbakemelding = '';
                teknikkVideoFiler = []; visTeknikkSkjema = false;
                await hentTeknikk();
            } else {
                // Les faktisk feilmelding fra serveren
                const data = await res.json().catch(() => ({}));
                teknikkFeil = data.error ?? `Serverfeil (${res.status})`;
            }
        } catch (error) {
            // Vis den faktiske feilen i stedet for en generisk tekst
            teknikkFeil = error instanceof Error ? error.message : String(error);
        } finally {
            teknikkLaster = false;
            uploadProgress = 0;
            uploadProgressList = [];
        }
    }
    
    async function slettTeknikklogg(id: number) {
        if (!confirm('Slett denne loggen?')) return;
        try {
            await fetch('/api/teknikk', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            await hentTeknikk();
        } catch {}
    }

    let redigerLogg: TeknikkLogg | null = null;
    let redigerDato = '';
    let redigerStilart = '';
    let redigerTilbakemelding = '';
    let redigerVideoUrls: string[] = [];
    let redigerNyeVideoFiler: File[] = [];
    let redigerUploadProgress: number[] = [];
    let redigerFeil = '';
    let redigerLaster = false;
    
    function startRediger(logg: TeknikkLogg) {
        redigerLogg = logg;
        redigerDato = logg.dato.slice(0, 10);
        redigerStilart = logg.stilart;
        redigerTilbakemelding = logg.tilbakemelding;
        redigerVideoUrls = [...(logg.video_urls ?? [])];
    }
    
    async function lagreRediger() {
        if (!redigerLogg || !redigerDato || !redigerStilart) return;
        redigerLaster = true;
        redigerFeil = '';
        uploadProgress = 0;

        try {
            const nyeUrls: string[] = [];

            if (redigerNyeVideoFiler.length > 0) {
                const totalBytes = redigerNyeVideoFiler.reduce((s, f) => s + f.size, 0);
                const loadedPerFile = new Array(redigerNyeVideoFiler.length).fill(0);

                for (let i = 0; i < redigerNyeVideoFiler.length; i++) {
                    const url = await new Promise<string>((resolve, reject) => {
                        const fd = new FormData();
                        fd.append('file', redigerNyeVideoFiler[i]);
                        fd.append('upload_preset', PUBLIC_CLOUDINARY_UPLOAD_PRESET);
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', `https://api.cloudinary.com/v1_1/${PUBLIC_CLOUDINARY_CLOUD_NAME}/video/upload`);
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable) {
                                loadedPerFile[i] = e.loaded;
                                const totalLoaded = loadedPerFile.reduce((s, b) => s + b, 0);
                                uploadProgress = Math.round((totalLoaded / totalBytes) * 100);
                            }
                        };
                        xhr.onload = () => xhr.status === 200
                            ? resolve(JSON.parse(xhr.responseText).secure_url)
                            : reject(new Error(`Cloudinary: ${JSON.parse(xhr.responseText)?.error?.message ?? xhr.status}`));
                        xhr.onerror = () => reject(new Error('Nettverksfeil'));
                        xhr.send(fd);
                    });
                    nyeUrls.push(url);
                }
            }

            const res = await fetch('/api/teknikk', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: redigerLogg.id,
                    dato: redigerDato,
                    stilart: redigerStilart,
                    tilbakemelding: redigerTilbakemelding,
                    video_urls: [...redigerVideoUrls, ...nyeUrls]
                })
            });

            if (res.ok) {
                redigerLogg = null;
                redigerNyeVideoFiler = [];
                await hentTeknikk();
            } else {
                const data = await res.json().catch(() => ({}));
                redigerFeil = data.error ?? `Serverfeil (${res.status})`;
            }
        } catch (error) {
            redigerFeil = error instanceof Error ? error.message : String(error);
        } finally {
            redigerLaster = false;
            uploadProgress = 0;
        }
    }

    let playingIndex = null;

    function handlePlay(i) {
        playingIndex = i;
    }

    function handlePause() {
        playingIndex = null;
    }

</script>

<style>
    /* ── FARGEPALETT ──────────────────────────────────────────────────────────────
    --surface (svak bakgrunnsfarge):
    lys:  #F1F5F9  (nesten hvit, subtil løftet flate)
    mørk: #1E3045  (lys-grå tilsvarende kalender frem/tilbake-knapper)
    ─────────────────────────────────────────────────────────────────────────── */
    :global(.lt){--p1:#19747E;--p2:#A9D6E5;--p3:#D1E8E2;--bg:#F1F5F9;--card:#ffffff;--br:#E2E8F0;--surface:#F1F5F9}
    :global(.dk){--p1:#92e811;--p2:#cbff71;--p3:#1f3910;--bg:#0D1B2A;--card:#132030;--br:#1E3448;--surface:#1E3045}
    /* Bakgrunnsfarger i mørkmodus */
    :global(.dk .bg-white){background-color:var(--card)!important}
    :global(.dk .bg-slate-50){background-color:var(--surface)!important}
    :global(.dk .bg-slate-100){background-color:var(--surface)!important}
    /* Hover-tilstander i mørkmodus – svak bakgrunn i stedet for hvittone */
    :global(.dk .hover\:bg-slate-50:hover){background-color:var(--surface)!important}
    :global(.dk .hover\:bg-slate-100:hover){background-color:var(--br)!important}
    :global(.dk .hover\:bg-slate-200:hover){background-color:var(--br)!important}
    :global(.dk .hover\:bg-red-50:hover){background-color:#2d0a0a!important}
    :global(.dk .border-slate-200),:global(.dk .border-slate-100){border-color:var(--br)!important}
    :global(.dk .text-slate-800),:global(.dk .text-slate-700),:global(.dk .text-slate-600){color:#CBD5E1!important}
    :global(.dk .text-slate-500),:global(.dk .text-slate-400),:global(.dk .text-slate-300){color:#64748B!important}
    /* Inputskjema teknikk i mørkmodus */
    :global(.dk .teknikk-skjema input),
    :global(.dk .teknikk-skjema select),
    :global(.dk .teknikk-skjema textarea),
    :global(.dk .teknikk-skjema label) {color: #F1F5F9 !important;}
    /* Inputskjema teknikk i lysmodus */
    :global(.lt .teknikk-skjema input),
    :global(.lt .teknikk-skjema select),
    :global(.lt .teknikk-skjema textarea),
    :global(.lt .teknikk-skjema label) {color: #64748B !important;}
</style>

{#if !loggedIn}
<div class="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-[#0D1B2A] via-[#0D1B2A]/95 to-[#132030] p-4">
    <div class="w-full max-w-sm bg-[#132030] rounded-3xl p-8 shadow-2xl border border-[#1E3448]">
        <h2 class="text-center font-bold text-3xl mb-1">
            <span class="text-[#cbff71] italic">TRENINGS</span><span class="text-[#92e811] italic">PLAN</span>
        </h2>
        <p class="text-center text-[#64748B] text-sm mb-8">Logg inn for å se din treningsplan</p>

        <div class="mb-4">
            <label for="username" class="block text-xs font-semibold text-[#CBD5E1] uppercase tracking-widest mb-1.5">Brukernavn</label>
            <input id="username" type="text" bind:value={username} disabled={isLoading}
                class="w-full rounded-xl border border-[#1E3448] bg-[#1E3045] text-[#F1F5F9] px-4 py-3 text-base focus:border-[#92e811]/60 focus:ring-2 focus:ring-[#92e811] outline-none transition disabled:opacity-60 placeholder-slate-500"
                placeholder="Ditt brukernavn" autocomplete="username" />
        </div>
        <div class="mb-6">
            <label for="password" class="block text-xs font-semibold text-[#CBD5E1] uppercase tracking-widest mb-1.5">Passord</label>
            <input id="password" type="password" bind:value={password} disabled={isLoading}
                on:keydown={(e) => { if (e.key === "Enter") handleLogin(); }}
                class="w-full rounded-xl border border-[#1E3448] bg-[#1E3045] text-[#F1F5F9] px-4 py-3 text-base focus:border-[#92e811]/60 focus:ring-2 focus:ring-[#92e811] outline-none transition disabled:opacity-60 placeholder-slate-500"
                placeholder="••••••••" autocomplete="current-password" />
        </div>

        {#if loginError}
            <div class="mb-4 rounded-xl bg-red-900/30 border border-red-800 p-3 text-sm text-red-200">{loginError}</div>
        {/if}

        <button on:click={handleLogin} disabled={isLoading || !username || !password}
            class="w-full flex items-center justify-center gap-2 rounded-xl bg-[#92e811] text-[#132030] py-3 text-base font-bold tracking-wide transition disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#cbff71]">
            {#if isLoading}
                <svg class="h-5 w-5 animate-spin text-[#132030]" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Logger inn…
            {:else}
                Logg inn
            {/if}
        </button>
    </div>
</div>
{/if}

{#if loggedIn}
<div class="min-h-screen {darkMode?'dk':'lt'}" style="background-color:var(--bg)">

    <!-- HEADER -->
    <header class="sticky top-0 z-50" style="background-color:var(--bg)">
        <div class="mx-auto max-w-5xl px-4 pt-5 pb-2">
            <div class="flex justify-between items-end">
                <div>
                    <p class="text-xs font-semibold tracking-widest text-[var(--p1)] uppercase mb-0.5">
                        {format(activeDate, "EEEE d. MMMM", { locale: nb })}
                    </p>
                    <h1 class="text-3xl md:text-4xl font-bold italic leading-none tracking-tight">
                        <span class="text-[var(--p2)]">TRENINGS</span><span class="text-[var(--p1)]">PLAN</span>
                    </h1>
                </div>
                <div class="flex gap-2 self-end">
                    <button on:click={openCalendarModal}
                        class="bg-white text-[var(--p1)] rounded-full p-2 md:p-2.5 transition-colors border border-transparent hover:border-[var(--p1)]"
                        aria-label="Kalender">
                        <Calendar class="h-4 w-4 md:h-5 md:w-5" />
                    </button>

                    <button on:click={() => { activeModal = "profile"; showStyrkeSubmenu = false; }}
                        class="bg-white text-[var(--p1)] rounded-full p-2 md:p-2.5 transition-colors border border-transparent hover:border-[var(--p1)]"
                        aria-label="Profil">
                        <User class="h-4 w-4 md:h-5 md:w-5" />
                    </button>
                </div>
            </div>

            {#if isAdmin}
                <div class="mt-3 flex gap-2">
                    <input type="text" bind:value={currentUtoverNavn}
                        on:keydown={(e) => { if (e.key === "Enter") searchUtoverByName(); }}
                        placeholder="Søk etter utøver…"
                        class="flex-1 rounded-full border px-4 py-2 text-sm focus:ring-2 focus:ring-[color:var(--p1)] outline-none transition bg-[var(--card)] border-[var(--p1)/40] text-[var(--p1)] placeholder-[color:var(--p1)/50]" />
                    <button on:click={searchUtoverByName} disabled={isLoading || !currentUtoverNavn.trim()}
                        class="rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-50 bg-[var(--p1)] hover:bg-[var(--p1)]/80 text-[var(--card)]">
                        {isLoading ? "…" : "Søk"}
                    </button>
                </div>
                {#if loginError}
                    <div class="mt-2 rounded-lg bg-red-500/80 text-white text-sm px-3 py-2">{loginError}</div>
                {/if}
            {/if}
        </div>
    </header>

    <!-- MAIN -->
    <main class="mx-auto max-w-5xl px-4 py-6 space-y-8">

        <!-- MINE TRENINGSØKTER -->
        <section>
            <div class="flex items-center justify-between mb-3">
                <h2 class="text-base font-bold text-[var(--p1)]">Mine Treningsøkter:</h2>
                <span class="text-xs font-bold text-[var(--p2)] px-2.5 py-1 tracking-wide">UKE {currentWeekNum}</span>
            </div>

            <!-- Card scroll row with arrow buttons inside -->
            <div class="relative">
                <div bind:this={cardScrollEl}
                    class="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory"
                    style="scrollbar-width:none; -webkit-overflow-scrolling:touch;">

                    <!-- Left: extend back in time – only visible at the far left end -->
                    <button on:click={extendCardBack}
                        class="flex-shrink-0 snap-start self-center w-10 h-10 flex items-center justify-center bg-white border border-slate-200 hover:border-[var(--p1)] hover:text-[var(--p1)]/80 text-slate-400 rounded-xl shadow-sm transition-colors">
                        <ChevronLeft class="h-6 w-6" />
                    </button>

                    {#each cardDays as day}
                        {@const dayIso = format(day, "yyyy-MM-dd")}
                        {@const dw = workouts.filter(w => w.date === dayIso)}
                        {@const isT = isSameDay(day, today)}
                        {@const isAct = isSameDay(day, activeDate)}
                        {@const isRest = dw.length === 0 || dw.every(w => w.title.toLowerCase().includes("hvile"))}
                        {@const hasComment = dw.some(w => w.description && w.description.trim().length > 0)}
                        {@const isDouble = dw.length >= 2}

                        <button
                            class="flex-shrink-0 snap-start w-36 rounded-2xl p-3 text-left transition-all duration-150 flex flex-col
                                {isT
                                    ? 'bg-[var(--p3)] border-2 border-[var(--p1)]'
                                    : isAct
                                        ? 'bg-white border-2 border-[var(--p1)]'
                                        : 'bg-white border border-slate-200 hover:border-[var(--p1)]'}"
                            on:click={() => {
                                selectedDate = startOfDay(day);
                                if (dw.length > 0) openSessionDetail(dayIso, dw);
                                else { selectedSessionGroup = null; activeModal = null; }
                            }}
                        >
                            <!-- Date row -->
                            <div class="flex items-center justify-between w-full mb-2">
                                <span class="text-xs font-semibold capitalize {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">
                                    {isT ? "I dag" : format(day, "EEE", { locale: nb })}
                                </span>
                                <span class="text-xs font-bold {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">{format(day, "dd.MM")}</span>
                            </div>

                            {#if dw.length > 0}
                                <!-- Movement-form heading(s): UPPERCASE ITALIC -->
                                <div class="mb-2">
                                    {#each dw as w, wi}
                                        <p class="text-sm font-bold italic uppercase leading-tight {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">
                                            {getCardTitle(w.title)}{wi === 0 && isDouble ? " +" : ""}
                                        </p>
                                    {/each}
                                </div>

                                <!-- Icons — no background -->
                                <div class="flex gap-1.5 flex-wrap mb-2">
                                    {#each dw as w}
                                        {@const info = getWorkoutInfo(w.title, darkMode)}
                                        <svelte:component this={info.icon} class="h-6 w-6 {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}" />
                                    {/each}
                                </div>

                                <!-- Full workout names -->
                                <div class="flex flex-col {isDouble ? 'gap-2' : 'gap-0.5'} flex-1">
                                    {#each dw as w}
                                        <p class="text-xs leading-snug {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">{w.title}</p>
                                    {/each}
                                </div>

                                <!-- Footer: only on non-rest days -->
                                {#if !isRest}
                                    <div class="flex items-center justify-between w-full pt-1.5 mt-3 border-t {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">
                                        <span class="flex items-center gap-0.5 text-xs font-semibold {isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">
                                            <User class="h-3 w-3" /> {fellesCountByDay.get(dayIso) ?? 0}
                                        </span>
                                        {#if hasComment}
                                            <span class="{isT ? 'text-[var(--p1)]' : 'text-[var(--p2)]'}">
                                                <MessageSquare class="h-3.5 w-3.5" />
                                            </span>
                                        {:else}
                                            <span></span>
                                        {/if}
                                    </div>
                                {/if}
                            {:else}
                            <div class="flex-1 flex flex-col items-center justify-center gap-1 text-center px-1 {isT ? 'text-[var(--p1)]/50' : 'text-slate-300'}">
                                <span class="text-xs leading-tight">Ingen økt er lagt inn enda…</span>
                            </div>
                            {/if}
                        </button>
                    {/each}

                    <!-- Right: extend forward in time – only visible at the far right end -->
                    <button on:click={extendCardForward}
                        class="flex-shrink-0 snap-start self-center w-10 h-10 flex items-center justify-center bg-white border border-slate-200 hover:border-[var(--p1)] hover:text-[var(--p1)]/80 text-slate-400 rounded-xl shadow-sm transition-colors">
                        <ChevronRight class="h-6 w-6" />
                    </button>
                </div>
            </div>
        </section>

        <!-- TEKNIKKLOGG -->
        <section class="mt-20">
            <div class="flex items-center justify-between mb-3">
                <h2 class="text-base font-bold text-[var(--p1)]">Teknikklogg:</h2>
                <button on:click={() => { visTeknikkSkjema = !visTeknikkSkjema; teknikkFeil = ''; }}
                    class="flex items-center gap-1.5 bg-[var(--p1)] text-white rounded-full px-3 py-1.5 text-xs font-bold hover:bg-[var(--p1)]/80 transition-colors">
                    <Plus class="h-3.5 w-3.5" />
                    Ny logg
                </button>
            </div>
        
            {#if visTeknikkSkjema}
                <div class="teknikk-skjema bg-white rounded-2xl border border-slate-200 p-4 mb-4">
                    <h3 class="font-bold text-sm text-[var(--p1)] mb-3">Logg ny teknikkøkt</h3>
        
                    <div class="flex flex-col gap-3">
                        <div class="w-full min-w-0 overflow-hidden">
                            <label class="block text-xs font-semibold uppercase tracking-widest mb-1">Dato</label>
                            <input type="date" bind:value={teknikkDato}
                                class="w-full appearance-none max-w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] focus:ring-2 focus:ring-[var(--p1)]/20 transition" />
                        </div>
        
                        <div>
                            <label class="block text-xs font-semibold uppercase tracking-widest mb-1">Stilart</label>
                            <select bind:value={teknikkStilart}
                                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] transition">
                                <option value="">Velg stilart…</option>
                                <option>Klassisk</option>
                                <option>Skate</option>
                            </select>
                        </div>
        
                        <div>
                            <label class="block text-xs font-semibold uppercase tracking-widest mb-1">Tilbakemelding / hva øvde du på</label>
                            <textarea bind:value={teknikkTilbakemelding} rows="3"
                                placeholder="F.eks. fokus på armtrekket, tilbakemelding fra trener…"
                                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] transition resize-none" />
                        </div>
        
                        <div>
                            <label class="block text-xs font-semibold uppercase tracking-widest mb-1">Video (valgfritt)</label>
                            <label class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 cursor-pointer hover:border-[var(--p1)] transition-colors">
                            <input type="file" accept="video/*" multiple class="hidden"
                                on:change={(e) => {
                                    const valgte = Array.from(e.currentTarget.files ?? []);
                                    if (valgte.length > 6) {
                                        teknikkFeil = 'Maks 6 videoer per logg.';
                                        return;
                                    }
                                    teknikkFeil = '';
                                    teknikkVideoFiler = valgte;
                                }} />
                                {#if teknikkVideoFiler.length > 0}
                                    <Video class="h-5 w-5 text-[var(--p1)] mb-1" />
                                    {#each teknikkVideoFiler as fil, i}
                                        <p class="text-sm text-[var(--p1)] font-semibold truncate max-w-full">{fil.name}</p>
                                        {#if uploadProgressList[i] > 0}
                                            <div class="w-full rounded-full overflow-hidden bg-slate-100 h-1.5 mt-1">
                                                <div class="h-1.5 bg-[var(--p1)] rounded-full transition-all" style="width:{uploadProgressList[i]}%"></div>
                                            </div>
                                        {/if}
                                    {/each}
                                {:else}
                                    <Video class="h-5 w-5 text-slate-300 mb-1" />
                                    <p class="text-sm text-slate-400">Trykk for å velge én eller flere videoer</p>
                                {/if}
                            </label>
                        </div>
        
                        {#if teknikkLaster && uploadProgress > 0}
                            <div>
                                <div class="rounded-full overflow-hidden bg-slate-100 h-2">
                                    <div class="h-2 bg-[var(--p1)] transition-all duration-200 rounded-full"
                                        style="width:{uploadProgress}%"></div>
                                </div>
                                <p class="text-xs text-center text-slate-400 mt-1">
                                    {teknikkVideoFiler.length > 1 ? `Laster opp videoer… ` : `Laster opp video… `}{uploadProgress}%
                                </p>
                            </div>
                        {/if}
        
                        {#if teknikkFeil}
                            <p class="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{teknikkFeil}</p>
                        {/if}
        
                        <div class="flex gap-2 pt-1">
                            <button on:click={() => { visTeknikkSkjema = false; teknikkFeil = ''; }}
                                class="flex-1 rounded-xl border py-2.5 text-sm font-semibold hover:bg-slate-50 transition-colors"
                                style="border-color:{darkMode ? '#F1F5F9' : '#64748B'}; color:{darkMode ? '#F1F5F9' : '#64748B'}">
                                Avbryt
                            </button>
                            <button on:click={lagreTeknikklogg}
                                disabled={teknikkLaster || !teknikkDato || !teknikkStilart}
                                class="flex-1 rounded-xl bg-[var(--p1)] text-white py-2.5 text-sm font-bold disabled:opacity-40 transition-colors">
                                {teknikkLaster ? (uploadProgress > 0 ? `${uploadProgress}%` : 'Lagrer…') : 'Lagre'}
                            </button>
                        </div>
                    </div>
                </div>
            {/if}
        
            <div class="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory"
                style="scrollbar-width:none; -webkit-overflow-scrolling:touch;">
            
                {#if teknikkLogger.length === 0}
                    <div class="bg-white rounded-2xl border border-slate-200 p-6 text-center w-full">
                        <Video class="h-8 w-8 text-slate-300 mx-auto mb-2" />
                        <p class="text-sm text-slate-400">Ingen teknikkøkter logget ennå.</p>
                    </div>
                {:else}
                    {#each teknikkLogger as logg}
                        <button
                            class="flex-shrink-0 snap-start w-44 rounded-2xl p-3 text-left bg-white border border-slate-200 hover:border-[var(--p1)] transition-all duration-150 flex flex-col"
                            on:click={() => { selectedTeknikkLogg = logg; activeModal = 'teknikk'; }}>
            
                            <!-- Teknikk + stilart -->
                            <p class="text-sm font-bold italic uppercase leading-tight text-[var(--p2)] mb-1.5">
                                Teknikk {logg.stilart}
                            </p>
            
                            <!-- Dato -->
                            <p class="text-xs font-semibold text-[var(--p2)] mb-3">
                                {format(parseISO(logg.dato), 'd. MMM yyyy', { locale: nb })}
                            </p>
            
                            <!-- Thumbnail om video finnes -->
                            {#if logg.video_urls?.length > 0}
                                <div class="w-full rounded-lg overflow-hidden mb-2 bg-slate-100" style="aspect-ratio:16/9">
                                    <img src={cloudinaryThumb(logg.video_urls[0])} alt="Video thumbnail"
                                        class="w-full h-full object-cover" loading="lazy"
                                        on:error={(e) => e.currentTarget?.remove()} />
                                </div>
                            {/if}
            
                            <!-- Ikoner -->
                            {#if logg.tilbakemelding || logg.video_urls?.length > 0}
                                <div class="flex items-center gap-2 mt-auto pt-1 text-[var(--p2)]">
                                    {#if logg.tilbakemelding}
                                        <MessageSquare class="h-5 w-5" />
                                    {/if}
                                    {#if logg.video_urls?.length > 0}
                                        <Video class="h-5 w-5" />
                                    {/if}
                                </div>
                            {/if}
                        </button>
                    {/each}
                {/if}
            </div>
        </section>

        <!-- STATISTIKK -->
        <section>
            <div class="mb-3">
                <h2 class="text-base font-bold text-[var(--p1)] mb-2">Statistikk:</h2>
                <div class="flex items-center gap-2">
                    <!-- Prev / Next navigation -->
                    <button on:click={prevStatPeriod}
                        class="bg-white border border-slate-200 hover:border-[var(--p1)] text-slate-400 hover:text-[var(--p1)] rounded-lg p-1.5 transition-colors">
                        <ChevronLeft class="h-4 w-4" />
                    </button>

                    <!-- Period dropdown -->
                    <div class="relative">
                        <button on:click={() => showStatDropdown = !showStatDropdown}
                            class="flex items-center gap-1.5 bg-white border border-slate-200 hover:border-[var(--p1)] rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--p1)] transition-colors min-w-[130px] justify-between">
                            <span class="capitalize">{statPeriodLabel}</span>
                            <ChevronDown class="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                        </button>
                        {#if showStatDropdown}
                            <div class="absolute left-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[120px]">
                                {#each [["uke","Uke"],["maaned","Måned"],["sesong","Sesong"]] as [val, lbl]}
                                    <button on:click={() => setPeriod(val)}
                                        class="w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors {statPeriod === val ? 'bg-[var(--p1)] text-white' : 'text-slate-600 hover:bg-slate-50'}">
                                        {lbl}
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <button on:click={nextStatPeriod}
                        class="bg-white border border-slate-200 hover:border-[var(--p1)] text-slate-400 hover:text-[var(--p1)] rounded-lg p-1.5 transition-colors">
                        <ChevronRight class="h-4 w-4" />
                    </button>

                    <!-- Calendar picker button -->
                    <button on:click={openStatCalendar}
                        class="bg-white border border-slate-200 hover:border-[var(--p1)] text-slate-400 hover:text-[var(--p1)] rounded-lg p-1.5 transition-colors">
                        <Calendar class="h-4 w-4" />
                    </button>
                </div>
            </div>

            <!-- Stat Calendar Picker -->
            {#if showStatCalendar}
                <div class="fixed inset-0 z-40 flex items-center justify-center pt-24 bg-slate-900/40 backdrop-blur-sm"
                    on:click={() => showStatCalendar = false}
                    role="button" tabindex="0"
                    on:keydown={(e) => e.key === "Escape" && (showStatCalendar = false)} aria-label="Lukk">
                    <div class="bg-white w-full max-w-xs rounded-3xl p-5 shadow-2xl"
                        on:click|stopPropagation role="dialog" aria-modal="true">
                        <div class="flex justify-end mb-2">
                            <button on:click={() => showStatCalendar = false}
                                class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-lg p-1.5 text-slate-500 transition-colors">
                                <X class="h-5 w-5" />
                            </button>
                        </div>
                        <div class="flex items-center justify-between mb-4">
                            <button on:click={() => { statCalendarCursor = subMonths(statCalendarCursor, 1); updateStatCalendarDays(); }}
                                class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-xl p-2 transition-colors">
                                <ChevronLeft class="h-4 w-4 text-[var(--p1)]" />
                            </button>
                            <h3 class="font-bold text-slate-800 capitalize">{format(statCalendarCursor, "MMMM yyyy", { locale: nb })}</h3>
                            <button on:click={() => { statCalendarCursor = addMonths(statCalendarCursor, 1); updateStatCalendarDays(); }}
                                class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-xl p-2 transition-colors">
                                <ChevronRight class="h-4 w-4 text-[var(--p1)]" />
                            </button>
                        </div>
                        <div class="grid grid-cols-7 gap-1 mb-1">
                            {#each ["Ma","Ti","On","To","Fr","Lø","Sø"] as d}
                                <div class="text-center text-xs font-bold text-slate-400 py-1">{d}</div>
                            {/each}
                        </div>
                        <div class="grid grid-cols-7 gap-1">
                            {#each statCalendarDays as d}
                                {#if d}
                                    {@const isT = isSameDay(d, today)}
                                    {@const isSel = isSameDay(d, statAnchor)}
                                    <button on:click={() => selectStatCalendarDate(d)}
                                        class="aspect-square rounded-lg text-sm flex items-center justify-center transition-colors
                                            {isSel ? 'bg-[var(--p1)] text-white font-bold' : isT ? 'bg-[var(--p2)] text-[var(--p1)] font-bold' : 'hover:bg-slate-100 text-slate-700'}">
                                        {format(d, "d")}
                                    </button>
                                {:else}
                                    <div></div>
                                {/if}
                            {/each}
                        </div>
                        <button on:click={() => selectStatCalendarDate(today)}
                            class="w-full mt-4 py-2.5 rounded-xl border border-[var(--p1)] bg-[var(--p3)] text-[var(--p1)] text-sm font-semibold transition-colors">
                            Gå til i dag
                        </button>
                    </div>
                </div>
            {/if}

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <!-- BAR CHART -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <svg viewBox="0 0 272 110" class="w-full pb-3">
                        {#each [0.33, 0.66, 1] as frac}
                            <line x1="18" y1={90 - frac * 70} x2="260" y2={90 - frac * 70} stroke="#E2E8F0" stroke-width="0.7"/>
                            <text x="16" y={90 - frac * 70 + 2} font-size="6" fill="#94A3B8" text-anchor="end">{Math.round(frac * barMaxV)}</text>
                        {/each}
                        {#each barChartItems as item}
                            <rect x={item.x+1} y={item.y+1} width={item.bw} height={item.bh} fill="rgba(0,0,0,0.05)" rx="5"/>
                            <rect x={item.x} y={item.y} width={item.bw} height={item.bh} fill={item.barColor} rx="5"/>
                            <text x={item.x + item.bw/2} y={item.y - 3} text-anchor="middle" font-size="8" font-weight="700" fill={item.barColor}>{item.value}</text>
                            <text x={item.x + item.bw/2} y="106" text-anchor="middle" font-size="6.5" fill="#64748B" transform={`rotate(-28, ${item.x + item.bw/2}, 106)`}>{item.label}</text>
                        {/each}
                        <line x1="18" y1="90" x2="260" y2="90" stroke="#CBD5E1" stroke-width="0.8"/>
                    </svg>
                    <!-- Antall økter at the bottom -->
                    <div class="text-center pt-2 border-t border-slate-100">
                        <span class="text-sm text-slate-500 font-medium ml-1.5">Antall økter: </span>
                        <span class="text-md font-bold text-[var(--p1)]">{barStats.total}</span>
                    </div>
                </div>

                <!-- LINE CHART -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    {#if lineChartData.length > 1}
                        <svg viewBox="0 0 272 110" class="w-full"
                            on:mouseleave={() => lineTooltip = null}
                            on:click={() => lineTooltip = null}>
                            <defs>
                                <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="var(--p1)" stop-opacity="0.25"/>
                                    <stop offset="100%" stop-color="var(--p1)" stop-opacity="0.02"/>
                                </linearGradient>
                            </defs>
                            <path d={lineArea} fill="url(#lg)"/>
                            {#each lineYTicks as tick}
                                {@const ty = 82 - (tick / lineMaxCeil) * 62}
                                <line x1="28" y1={ty} x2="258" y2={ty} stroke="#E2E8F0" stroke-width="0.7"/>
                                <text x="26" y={ty + 2} font-size="6" fill="#94A3B8" text-anchor="end">{tick}t</text>
                            {/each}
                            <polyline points={linePoly} fill="none" stroke="var(--p1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                            {#each linePts as p}
                                <!-- Invisible wider hit area -->
                                <circle cx={p.x} cy={p.y} r="10" fill="transparent"
                                    on:mouseenter={() => lineTooltip = p}
                                    on:mouseleave={() => lineTooltip = null}
                                    on:click|stopPropagation={() => lineTooltip = p}
                                    class="cursor-pointer" />
                                <circle cx={p.x} cy={p.y} r={lineTooltip?.label === p.label ? 4.5 : 3}
                                    fill="var(--card)" stroke="var(--p1)"
                                    stroke-width={lineTooltip?.label === p.label ? 2.5 : 1.5}
                                    style="transition: r 0.1s, stroke-width 0.1s; pointer-events: none;" />
                                <text x={p.x} y="108" text-anchor="middle" font-size="6.5" fill="#64748B">{p.label}</text>
                            {/each}
                            <!-- Tooltip bubble -->
                            <line x1="28" y1="88" x2="258" y2="88" stroke="#CBD5E1" stroke-width="0.8"/>
                            <!-- Tooltip bubble – rendered last so it's always on top -->
                            {#if lineTooltip}
                                {@const tx = Math.min(Math.max(lineTooltip.x, 30), 242)}
                                {@const ty = Math.max(lineTooltip.y - 18, 10)}
                                {@const totalMin = Math.round(lineTooltip.hours * 60)}
                                {@const hh = Math.floor(totalMin / 60)}
                                {@const mm = totalMin % 60}
                                {@const lbl = hh > 0 && mm > 0 ? `${hh}t ${mm}m` : hh > 0 ? `${hh}t` : `${mm}m`}
                                <rect x={tx - 16} y={ty - 8} width="32" height="12" rx="4" fill="var(--p1)"/>
                                <text x={tx} y={ty + 1} text-anchor="middle" font-size="6.5" font-weight="700" fill="white">{lbl}</text>
                            {/if}
                        </svg>
                    {:else}
                        <div class="flex items-center justify-center h-32 text-slate-400 text-sm">Ingen data ennå</div>
                    {/if}
                    <!-- Timer totalt at the bottom -->
                    <div class="text-center mt-1 pt-2 border-t border-slate-100">
                    <span class="text-sm text-slate-500 font-medium ml-1.5">Timer totalt:</span>
                        <span class="text-md font-bold text-[var(--p1)]">{barStats.totalHours}t{barStats.totalMins > 0 ? ` ${barStats.totalMins}min` : ""}</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- TEKNIKKVIDEOER -->
        <section>
            <h2 class="text-base font-bold text-[var(--p1)] mb-3">Teknikkvideoer:</h2>

            <div class="flex flex-col gap-3">

                <!-- Klassisk: Diagonal -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Klassisk: <span class="text-[var(--p2)] italic"> Diagonal </span> </p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("Z2oNfG4eulQ")}>
                                {#if activeVideos.has("Z2oNfG4eulQ")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/Z2oNfG4eulQ?autoplay=1" title="Diagonal" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/Z2oNfG4eulQ/hqdefault.jpg" alt="Diagonal" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("NNR6YpFA7Jw")}>
                                {#if activeVideos.has("NNR6YpFA7Jw")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/NNR6YpFA7Jw?autoplay=1" title="Diagonal 2" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/NNR6YpFA7Jw/hqdefault.jpg" alt="Diagonal 2" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Klassisk: Staking -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Klassisk: <span class="text-[var(--p2)] italic"> Staking </span></p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("D_hlp-buPhA")}>
                                {#if activeVideos.has("D_hlp-buPhA")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/D_hlp-buPhA?autoplay=1" title="Staking" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/D_hlp-buPhA/hqdefault.jpg" alt="Staking" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("MYVK4agNPcE")}>
                                {#if activeVideos.has("MYVK4agNPcE")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/MYVK4agNPcE?autoplay=1" title="Staking 2" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/MYVK4agNPcE/hqdefault.jpg" alt="Staking 2" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Klassisk: Dobbeltak med fraspark -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Klassisk: <span class="text-[var(--p2)] italic"> Dobbeltak med fraspark </span></p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("7SZn1vDG_WY")}>
                                {#if activeVideos.has("7SZn1vDG_WY")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/7SZn1vDG_WY?autoplay=1" title="Dobbeltak" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/7SZn1vDG_WY/hqdefault.jpg" alt="Dobbeltak med fraspark" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Skøyting: Dobbeldans -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Skøyting: <span class="text-[var(--p2)] italic"> Dobbeldans </span></p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("PlFkOEr7bw0")}>
                                {#if activeVideos.has("PlFkOEr7bw0")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/PlFkOEr7bw0?autoplay=1" title="Dobbeldans" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/PlFkOEr7bw0/hqdefault.jpg" alt="Dobbeldans" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("G-vIb6gzYRk")}>
                                {#if activeVideos.has("G-vIb6gzYRk")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/G-vIb6gzYRk?autoplay=1" title="Dobbeldans 2" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/G-vIb6gzYRk/hqdefault.jpg" alt="Dobbeldans 2" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Skøyting: Padling -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Skøyting: <span class="text-[var(--p2)] italic"> Padling </span></p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("Z6ynMU7KixA")}>
                                {#if activeVideos.has("Z6ynMU7KixA")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/Z6ynMU7KixA?autoplay=1" title="Padling" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/Z6ynMU7KixA/hqdefault.jpg" alt="Padling" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("-eWpFQ9rDos")}>
                                {#if activeVideos.has("-eWpFQ9rDos")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/-eWpFQ9rDos?autoplay=1" title="Padling 2" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/-eWpFQ9rDos/hqdefault.jpg" alt="Padling 2" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Skøyting: Enkeldans -->
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <p class="text-md font-bold text-[var(--p1)] mb-3">Skøyting: <span class="text-[var(--p2)] italic"> Enkeldans </span></p>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("8PLC-KWs4c0")}>
                                {#if activeVideos.has("8PLC-KWs4c0")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/8PLC-KWs4c0?autoplay=1" title="Enkeldans" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/8PLC-KWs4c0/hqdefault.jpg" alt="Enkeldans" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <div class="rounded-xl overflow-hidden shadow-sm">
                            <div class="aspect-video relative cursor-pointer group" on:click={() => activateVideo("QWZp2WVukkY")}>
                                {#if activeVideos.has("QWZp2WVukkY")}
                                    <iframe class="w-full h-full" src="https://www.youtube.com/embed/QWZp2WVukkY?autoplay=1" title="Enkeldans 2" frameborder="0" allowfullscreen allow="autoplay"></iframe>
                                {:else}
                                    <img class="w-full h-full object-cover" src="https://img.youtube.com/vi/QWZp2WVukkY/hqdefault.jpg" alt="Enkeldans 2" loading="lazy" />
                                    <div class="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 68 48" class="w-16 h-11 drop-shadow-lg group-hover:scale-110 transition-transform" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect width="68" height="48" rx="12" fill="#FF0000"/>
                                            <polygon points="26,14 26,34 46,24" fill="white"/>
                                        </svg>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>

        <div class="h-6"></div>
    </main>

    <!-- SESSION DETAIL MODAL -->
    {#if activeModal === "session" && selectedSessionGroup}
        <div class="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-900/40 backdrop-blur-sm"
            on:click={() => activeModal = null} role="button" tabindex="0"
            on:keydown={(e) => e.key === "Escape" && (activeModal = null)} aria-label="Lukk">
            <div class="bg-white w-full lg:max-w-2xl lg:mx-auto lg:rounded-3xl rounded-t-3xl max-h-[88vh] min-h-[50vh] lg:min-h-0 overflow-y-auto lg:my-8"
                use:swipeToDismiss
                on:click|stopPropagation role="dialog" aria-modal="true">
                <div class="max-w-lg mx-auto lg:max-w-none p-5 pb-8 relative">

                <!-- Drag handle (synlig på mobil og nettbrett) -->
                <div class="lg:hidden flex justify-center mb-5 -mt-1">
                    <div class="w-24 h-[5px] rounded-full bg-slate-300"></div>
                </div>

                <button on:click={() => activeModal = null}
                    class="hidden lg:flex absolute top-4 right-4 bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-lg p-1.5 text-slate-500 transition-colors">
                    <X class="h-5 w-5" />
                </button>

                <p class="font-bold text-lg mb-4 capitalize" style="color:var(--p1)">
                    {format(parseISO(selectedSessionGroup.date), "EEEE d. MMMM", { locale: nb })}
                </p>

                {#each selectedSessionGroup.sessions as s}
                    {@const info = getWorkoutInfo(s.title, darkMode)}
                    <div class="rounded-xl p-3.5 mb-3 {darkMode ? info.darkBg : info.bg}">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
                                <svelte:component this={info.icon} class="h-5 w-5 {info.color}" />
                            </div>
                            <div>
                                <p class="font-bold text-sm leading-tight mb-1"
                                    style="color:{darkMode ? 'var(--card)' : '#1E293B'}">{s.title}</p>
                                <div class="flex items-center gap-2 flex-wrap">
                                    {#if s.durationMin}
                                        <span class="flex items-center gap-1 font-bold text-sm"
                                        style="color:{darkMode ? 'var(--card)' : '#64748B'}">
                                            <Clock class="h-4 w-4" /> {formatTime(s.durationMin)}
                                        </span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}

                {#if selectedSessionGroup.sessions[0]?.description}
                    <div class="rounded-xl p-3.5 mt-1 mb-3 {darkMode ? '' : 'bg-slate-50'}"
                        style="{darkMode ? 'background-color:var(--surface)' : ''}">
                        <p class="text-xs font-bold uppercase tracking-widest mb-1.5"
                            style="color:{darkMode ? 'var(--p2)' : '#94A3B8'}">Kommentar</p>
                        <p class="text-sm leading-relaxed"
                            style="color:{darkMode ? '#CBD5E1' : '#334155'}">{selectedSessionGroup.sessions[0].description}</p>
                    </div>
                {/if}

                {#if !selectedSessionGroup.sessions.some(s => s.title.toLowerCase().includes("hvile"))}
                    {@const isDouble = selectedSessionGroup.sessions.length >= 2}
                    {@const f1 = getFellesUtovere(selectedSessionGroup.date, selectedSessionGroup.sessions[0]?.title)}
                    {@const f2 = isDouble ? getFellesUtovere(selectedSessionGroup.date, selectedSessionGroup.sessions[1]?.title) : []}
                    {@const allF = Array.from(new Set([...f1, ...f2]))}

                    <div class="mt-3">
                        <p class="flex items-center gap-2 text-sm font-semibold text-[var(--p1)] mb-2">
                            <Users class="h-4 w-4" />
                            {allF.length > 0 ? `${allF.length} andre har samme økt` : "Ingen andre har samme økt"}
                        </p>
                        {#if isDouble}
                            {#if f1.length > 0}
                                <p class="text-xs font-semibold text-slate-500 mb-1.5">Økt 1:</p>
                                <div class="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100">
                                    {#each f1 as u}<span class="bg-[var(--p3)]/50 text-[var(--p1)] rounded-full px-3 py-1 text-xs font-semibold border border-[var(--p1)]">{u}</span>{/each}
                                </div>
                            {:else}
                                <p class="text-xs text-slate-400 italic mb-3 pb-3 border-b border-slate-100">Økt 1: Ingen andre</p>
                            {/if}
                            {#if f2.length > 0}
                                <p class="text-xs font-semibold text-slate-500 mb-1.5">Økt 2:</p>
                                <div class="flex flex-wrap gap-1.5">
                                    {#each f2 as u}<span class="bg-[var(--p3)]/50 text-[var(--p1)] rounded-full px-3 py-1 text-xs font-semibold border border-[var(--p1)]">{u}</span>{/each}
                                </div>
                            {:else}
                                <p class="text-xs text-slate-400 italic">Økt 2: Ingen andre</p>
                            {/if}
                        {:else if f1.length > 0}
                            <div class="flex flex-wrap gap-1.5">
                                {#each f1 as u}<span class="bg-[var(--p3)]/50 text-[var(--p1)] rounded-full px-3 py-1 text-xs font-semibold border border-[var(--p1)]">{u}</span>{/each}
                            </div>
                        {:else}
                            <p class="text-xs text-slate-400 italic">Ingen andre er satt opp med denne økten.</p>
                        {/if}
                    </div>
                {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- TEKNIKK DETAIL MODAL -->
    {#if activeModal === "teknikk" && selectedTeknikkLogg}
        <div class="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-900/40 backdrop-blur-sm"
            on:click={() => { activeModal = null; redigerLogg = null; }} role="button" tabindex="0"
            on:keydown={(e) => e.key === "Escape" && (activeModal = null)} aria-label="Lukk">
            <div class="bg-white w-full lg:max-w-2xl lg:mx-auto lg:rounded-3xl rounded-t-3xl max-h-[88vh] min-h-[50vh] lg:min-h-0 overflow-y-auto lg:my-8"
                use:swipeToDismiss
                on:click|stopPropagation role="dialog" aria-modal="true">
                <div class="max-w-lg mx-auto lg:max-w-none p-5 pb-8 relative">
    
                    <!-- Drag handle (mobil) -->
                    <div class="lg:hidden flex justify-center mb-5 -mt-1">
                        <div class="w-24 h-[5px] rounded-full bg-slate-300"></div>
                    </div>
    
                    {#if redigerLogg?.id === selectedTeknikkLogg.id}
                        <!-- REDIGERINGSMODUS -->
                        <p class="font-bold text-lg text-[var(--p1)] mb-4">Rediger logg</p>
                        <div class="teknikk-skjema flex flex-col gap-3">
                            <div class="w-full min-w-0 overflow-hidden">
                                <label class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Dato</label>
                                <input type="date" bind:value={redigerDato}
                                    class="w-full appearance-none max-w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] focus:ring-2 focus:ring-[var(--p1)]/20 transition" />
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Stilart</label>
                                <select bind:value={redigerStilart}
                                    class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] transition">
                                    <option value="">Velg stilart…</option>
                                    <option>Klassisk</option>
                                    <option>Skate</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Tilbakemelding</label>
                                <textarea bind:value={redigerTilbakemelding} rows="3"
                                    class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-[var(--p1)] transition resize-none" />
                            </div>
                            {#if redigerVideoUrls.length > 0}
                                <div>
                                    <label class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
                                        Videoer ({redigerVideoUrls.length})
                                    </label>
                                    <div class="flex flex-col gap-2">
                                        {#each redigerVideoUrls as url, i}
                                            <div class="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                                <Video class="h-4 w-4 text-[var(--p1)] flex-shrink-0" />
                                                <span class="text-xs text-slate-500 truncate flex-1">Video {i + 1}</span>
                                                <button
                                                    on:click={() => redigerVideoUrls = redigerVideoUrls.filter((_, j) => j !== i)}
                                                    class="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                                                    title="Fjern video">
                                                    <X class="h-4 w-4" />
                                                </button>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                            <!-- Last opp nye videoer -->
                            <div>
                                <label class="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
                                    Legg til video
                                </label>
                                <label class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 cursor-pointer hover:border-[var(--p1)] transition-colors">
                                    <input type="file" accept="video/*" multiple class="hidden"
                                        on:change={(e) => {
                                            const valgte = Array.from(e.currentTarget.files ?? []);
                                            if (redigerVideoUrls.length + valgte.length > 6) {
                                                redigerFeil = `Maks 6 videoer per logg. Du har allerede ${redigerVideoUrls.length}.`;
                                                return;
                                            }
                                            redigerFeil = '';
                                            redigerNyeVideoFiler = valgte;
                                        }} />
                                    {#if redigerNyeVideoFiler.length > 0}
                                        <Video class="h-5 w-5 text-[var(--p1)] mb-1" />
                                        {#each redigerNyeVideoFiler as fil, i}
                                            <p class="text-sm text-[var(--p1)] font-semibold truncate max-w-full">{fil.name}</p>
                                            {#if redigerUploadProgress[i] > 0}
                                                <div class="w-full rounded-full overflow-hidden bg-slate-100 h-1.5 mt-1">
                                                    <div class="h-1.5 bg-[var(--p1)] rounded-full transition-all"
                                                        style="width:{redigerUploadProgress[i]}%"></div>
                                                </div>
                                            {/if}
                                        {/each}
                                    {:else}
                                        <Video class="h-5 w-5 text-slate-300 mb-1" />
                                        <p class="text-sm text-slate-400">Trykk for å legge til video(er)</p>
                                    {/if}
                                </label>
                            </div>

                            {#if redigerLaster && uploadProgress > 0}
                                <div>
                                    <div class="rounded-full overflow-hidden bg-slate-100 h-2">
                                        <div class="h-2 bg-[var(--p1)] transition-all duration-200 rounded-full"
                                            style="width:{uploadProgress}%"></div>
                                    </div>
                                    <p class="text-xs text-center text-slate-400 mt-1">
                                        {redigerNyeVideoFiler.length > 1 ? 'Laster opp videoer… ' : 'Laster opp video… '}{uploadProgress}%
                                    </p>
                                </div>
                            {/if}

                            {#if redigerFeil}
                                <p class="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{redigerFeil}</p>
                            {/if}
                            <div class="flex gap-2">
                                <button on:click={() => redigerLogg = null}
                                    class="flex-1 rounded-xl border py-2.5 text-sm font-semibold hover:bg-slate-50 transition-colors"
                                    style="border-color:{darkMode ? '#F1F5F9' : '#64748B'}; color:{darkMode ? '#F1F5F9' : '#64748B'}">
                                    Avbryt
                                </button>
                                <button on:click={async () => { await lagreRediger(); selectedTeknikkLogg = teknikkLogger.find(l => l.id === redigerLogg?.id) ?? null; }}
                                    disabled={redigerLaster || !redigerDato || !redigerStilart}
                                    class="flex-1 rounded-xl bg-[var(--p1)] text-white py-2.5 text-sm font-bold disabled:opacity-40 transition-colors">
                                    {redigerLaster ? 'Lagrer…' : 'Lagre'}
                                </button>
                            </div>
                        </div>
    
                    {:else}
                        <!-- VISNINGMODUS -->
                        <div class="flex items-start justify-between gap-2 mb-4">
                            <div>
                                <p class="font-bold text-lg leading-tight" style="color:var(--p1)">
                                    Teknikk – {selectedTeknikkLogg.stilart}
                                </p>
                                <p class="text-sm text-slate-400 mt-0.5">
                                    {format(parseISO(selectedTeknikkLogg.dato), 'd. MMMM yyyy', { locale: nb })}
                                </p>
                            </div>
                            <div class="flex gap-1 flex-shrink-0">
                                <button on:click={() => startRediger(selectedTeknikkLogg)}
                                    class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-lg p-1.5 text-slate-500 transition-colors">
                                    <SquarePen class="h-5 w-5" />
                                </button>
                                <button on:click={async () => { await slettTeknikklogg(selectedTeknikkLogg.id); activeModal = null; }}
                                    class="bg-[var(--surface)] hover:bg-red-400/50 rounded-lg p-1.5 text-slate-500 hover:text-red-500 transition-colors">
                                    <Trash2 class="h-5 w-5" />
                                </button>
                                <button on:click={() => { activeModal = null; redigerLogg = null; }}
                                    class="hidden lg:flex bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-lg p-1.5 text-slate-500 transition-colors">
                                    <X class="h-5 w-5" />
                                </button>
                            </div>
                        </div>
    
                        {#if selectedTeknikkLogg.tilbakemelding}
                            <div class="rounded-xl p-3.5 mb-3 {darkMode ? '' : 'bg-slate-50'}"
                                style="{darkMode ? 'background-color:var(--surface)' : ''}">
                                <p class="text-xs font-bold uppercase tracking-widest mb-1.5"
                                    style="color:{darkMode ? 'var(--p2)' : '#94A3B8'}">Kommentar</p>
                                <p class="text-sm leading-relaxed"
                                    style="color:{darkMode ? '#CBD5E1' : '#334155'}">{selectedTeknikkLogg.tilbakemelding}</p>
                            </div>
                        {/if}
    
                        {#if selectedTeknikkLogg.video_urls?.length > 0}
                            <div class="flex flex-col gap-3 mt-2">
                                {#each selectedTeknikkLogg.video_urls as url, i}
                                    <div class="rounded-xl overflow-hidden border border-slate-100">
                                        <video
                                            src={url}
                                            controls
                                            preload="none"
                                            poster={cloudinaryThumb(url)}
                                            playsinline
                                            on:play={() => handlePlay(i)}
                                            on:pause={handlePause}
                                            class="w-full bg-black aspect-video"
                                            style={`max-height:340px; object-fit:${playingIndex === i ? 'contain' : 'cover'}`}
                                        >
                                        </video>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- CALENDAR MODAL -->
    {#if activeModal === "calendar"}
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
            on:click={() => activeModal = null} role="button" tabindex="0"
            on:keydown={(e) => e.key === "Escape" && (activeModal = null)} aria-label="Lukk">
            <div class="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl relative"
                on:click|stopPropagation role="dialog" aria-modal="true">

                <!-- X close button – above month navigation -->
                <div class="flex justify-end mb-2">
                    <button on:click={() => activeModal = null}
                        class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-lg p-1.5 text-slate-500 transition-colors">
                        <X class="h-5 w-5" />
                    </button>
                </div>

                <div class="flex items-center justify-between mb-4">
                    <button on:click={() => { calendarModalCursor = subMonths(calendarModalCursor, 1); updateCalendarModalDays(); }}
                        class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-xl p-2 transition-colors">
                        <ChevronLeft class="h-4 w-4 text-[var(--p1)]" />
                    </button>
                    <h3 class="font-bold text-slate-800 capitalize">{format(calendarModalCursor, "MMMM yyyy", { locale: nb })}</h3>
                    <button on:click={() => { calendarModalCursor = addMonths(calendarModalCursor, 1); updateCalendarModalDays(); }}
                        class="bg-[var(--surface)] hover:bg-[var(--surface)]/50 rounded-xl p-2 transition-colors">
                        <ChevronRight class="h-4 w-4 text-[var(--p1)]" />
                    </button>
                </div>

                <div class="grid grid-cols-7 gap-1 mb-1">
                    {#each ["Ma","Ti","On","To","Fr","Lø","Sø"] as d}
                        <div class="text-center text-xs font-bold text-slate-400 py-1">{d}</div>
                    {/each}
                </div>
                <div class="grid grid-cols-7 gap-1">
                    {#each calendarModalDays as d}
                        {#if d}
                            {@const isT = isSameDay(d, today)}
                            {@const isSel = isSameDay(d, activeDate)}
                            {@const dayW = workouts.filter(w => w.date === format(d, "yyyy-MM-dd"))}
                            {@const hasW = dayW.length > 0}
                            {@const isDbl = dayW.length >= 2}
                            <button on:click={() => selectCalendarDate(d)}
                                class="aspect-square rounded-lg text-sm flex flex-col items-center justify-center gap-0.5 transition-colors
                                    {isSel ? 'bg-[var(--p1)] text-white font-bold' : isT ? 'bg-[var(--p2)] text-[var(--p1)] font-bold' : 'hover:bg-slate-100 text-slate-700'}">
                                {format(d, "d")}
                                {#if hasW}
                                    <div class="flex gap-0.5">
                                        <span class="w-1 h-1 rounded-full {isSel ? 'bg-white/70' : 'bg-[var(--p1)]'}"></span>
                                        {#if isDbl}<span class="w-1 h-1 rounded-full {isSel ? 'bg-white/50' : 'bg-[var(--p1)]'}"></span>{/if}
                                    </div>
                                {/if}
                            </button>
                        {:else}
                            <div></div>
                        {/if}
                    {/each}
                </div>

                <button on:click={() => selectCalendarDate(today)}
                    class="w-full mt-4 py-2.5 rounded-xl border border-[var(--p1)] bg-[var(--p3)] text-[var(--p1)] text-sm font-semibold transition-colors">
                    Gå til i dag
                </button>
            </div>
        </div>
    {/if}

    <!-- PROFILE PANEL -->
    {#if activeModal === "profile"}
        <div class="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm"
            on:click={() => { activeModal = null; showStyrkeSubmenu = false; }}
            role="button" tabindex="0"
            on:keydown={(e) => e.key === "Escape" && (activeModal = null)} aria-label="Lukk">
            <div class="bg-white h-full w-72 max-w-[85vw] shadow-2xl flex flex-col"
                use:swipeToClose
                on:click|stopPropagation role="dialog" aria-modal="true">

                <div class="bg-[var(--p1)] px-5 py-6 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                        <User class="h-4 w-4 text-white" />
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-white capitalize">{isAdmin ? (username.charAt(0).toUpperCase() + username.slice(1)) : username}</p>
                        {#if isAdmin && currentUtoverNavn}
                            <p class="text-xs text-white truncate">Viser: {currentUtoverNavn}</p>
                        {/if}
                    </div>
                    <button on:click={() => { activeModal = null; showStyrkeSubmenu = false; }}
                        class="bg-white/20 hover:bg-white/30 rounded-lg p-1.5 text-white transition-colors">
                        <X class="h-5 w-5" />
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-3">
                    {#if !showStyrkeSubmenu}
                        {#if currentEditPlanSheet}
                            <a href={currentEditPlanSheet} target="_blank" rel="noopener noreferrer"
                                on:click={() => activeModal = null}
                                class="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-[var(--surface)]/50 transition-colors text-left mb-1">
                                <span class="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                                    <SquarePen class="h-6 w-6 text-green-700" />
                                </span>
                                <span class="text-sm font-medium text-slate-700 truncate">
                                    {isAdmin && currentUtoverNavn ? `${currentUtoverNavn} – Google Sheet` : "Min treningsplan (Rediger)"}
                                </span>
                            </a>
                        {/if}

                        <button on:click={() => showStyrkeSubmenu = true}
                            class="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-[var(--surface)]/50 transition-colors text-left mb-1">
                            <span class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--surface)]">
                                <Dumbbell class="h-6 w-6 text-[var(--p1)]" />
                            </span>
                            <span class="text-sm font-medium text-slate-700 flex-1">Styrkeøkter</span>
                            <ChevronRight class="h-6 w-6 text-slate-300" />
                        </button>

                        <a href="/pdf/Intensitessoner.pdf" target="_blank" rel="noopener noreferrer"
                            on:click={() => activeModal = null}
                            class="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-[var(--surface)]/50 transition-colors text-left mb-1">
                            <span class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--surface)]">
                                <FileText class="h-6 w-6 text-[var(--p1)]" />
                            </span>
                            <span class="text-sm font-medium text-slate-700">Intensitetssoner</span>
                        </a>


                        <div class="flex items-center gap-3 w-full px-3 py-3 rounded-xl mb-1">
                            <span class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                                <Moon class="h-6 w-6 text-[var(--p1)]" />
                            </span>
                            <span class="text-sm font-medium text-slate-700 flex-1">Mørkt tema</span>
                            <button on:click|stopPropagation={() => darkMode = !darkMode}
                                class="relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0"
                                style="background-color:{darkMode?'var(--p1)':'#CBD5E1'}" aria-label="Bytt tema">
                                <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200"
                                    style="transform:translateX({darkMode?'20px':'0px'})"></span>
                            </button>
                        </div>

                        <div class="h-px bg-slate-100 my-2"></div>

                        <button on:click={handleLogout}
                            class="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-red-50 transition-colors text-left">
                            <span class="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                                <LogOut class="h-6 w-6 text-red-600" />
                            </span>
                            <span class="text-sm font-medium text-red-600">Logg ut</span>
                        </button>
                    {:else}
                        <button on:click={() => showStyrkeSubmenu = false}
                            class="flex items-center gap-2 text-sm font-semibold text-[var(--p1)] px-3 py-2 mb-2 hover:bg-[var(--p2)]/50 rounded-lg transition-colors">
                            <ArrowLeft class="h-6 w-6" /> Tilbake
                        </button>
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">Styrkeøkter</p>
                        {#each styrkeProgrammer as p}
                            <a href={p.url} target="_blank" rel="noopener noreferrer"
                                on:click={() => activeModal = null}
                                class="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-[var(--surface)]/50 transition-colors text-left mb-1">
                                <span class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--surface)]">
                                    <FileText class="h-6 w-6 text-[var(--p1)]" />
                                </span>
                                <span class="text-sm font-medium text-slate-700">{p.title}</span>
                            </a>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

</div>
{/if}

{#if isLoading && loggedIn}
    <div class="fixed top-0 inset-x-0 h-0.5 z-[999] animate-pulse" style="background:linear-gradient(to right,var(--p1),color-mix(in srgb,var(--p1) 20%,transparent),var(--p1))"></div>
{/if}
