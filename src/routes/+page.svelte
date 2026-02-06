<script lang="ts">
    import { tick } from "svelte";
    import Papa from "papaparse";
    import {
        parse,
        format,
        startOfDay,
        addDays,
        subDays,
        addMonths,
        subMonths,
        startOfMonth,
        endOfMonth,
        getDay,
        isSameDay,
        parseISO,
        isWithinInterval,
        startOfWeek,
        endOfWeek,
        startOfYear,
        endOfYear,
        addWeeks,
        subWeeks,
        addYears,
        subYears,
    } from "date-fns";
    import { nb } from "date-fns/locale";
    import {
        Calendar,
        LineChart,
        NotepadText,
        ChevronLeft,
        ChevronRight,
        Clock,
        Zap,
        Dumbbell,
        BookOpen,
        Timer,
        Heart,
        BatteryCharging,
        User,
        Lock,
        ChevronDown,
        ChevronUp,
        Users,
        Video,
        ArrowLeft,
    } from "lucide-svelte";


    // Login State
    let username = "";
    let password = "";
    let loggedIn = false;
    let loginError = "";
    let isLoading = false;
    let isAdmin = false;
    let currentUtoverNavn = "";
    let currentEditPlanSheet = "";


    // Felles økter data
    let fellesOkter: Array<{ dato: string; okt: string; utovere: string[] }> =
        [];
    let expandedDates = new Set<string>();

    // Initial State Check og Auto-Login
    if (typeof window !== "undefined") {
        isLoading = true;
        fetch('/api/verify')
            .then(res => res.json())
            .then(async (data) => {
                if (data.authenticated) {
                    loggedIn = true;
                    isAdmin = data.isAdmin;
                    username = data.username || "";
                    currentEditPlanSheet = data.editPlanSheet || "";  // LEGG TIL DENNE
                    
                    if (data.isAdmin) {
                            if (data.lastSearchName) {
                            currentUtoverNavn = data.lastSearchName;
                            // Automatisk søk på sist brukte navn
                            await searchUtoverByName();
                        }
                        isLoading = false;
                    } else {
                        // Vanlig bruker - last data
                        await Promise.all([
                            loadWorkoutPlan(data.sheetUrl), 
                            loadFellesOkter()
                        ]);
                        isLoading = false;
                        
                        // Trigger view refresh
                        const finalView = view;
                        const tempView = finalView === VIEWS.OVERVIEW 
                            ? VIEWS.CALENDAR 
                            : VIEWS.OVERVIEW;
                        view = tempView;
                        await tick();
                        view = finalView;
                        await tick();
                        goToToday();
                    }
                } else {
                    isLoading = false;
                }
            })
            .catch((error) => {
                console.error('Verify error:', error);
                isLoading = false;
            });
    }

    // Hovedfunksjon for innlogging
    async function handleLogin() {
        loginError = "";
        isLoading = true;

        const plainUser = username.trim().toLowerCase();

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: plainUser,
                    password: password
                })
            });

            const data = await response.json();

        if (data.success) {
            loggedIn = true;
            isAdmin = data.isAdmin;
            username = data.username;
            currentEditPlanSheet = data.editPlanSheet || "";  
            
            if (!data.isAdmin) {
                    await Promise.all([
                        loadWorkoutPlan(data.sheetUrl), 
                        loadFellesOkter()
                    ]);
                    const finalView = view;
                    const tempView = finalView === VIEWS.OVERVIEW ? VIEWS.CALENDAR : VIEWS.OVERVIEW;
                    view = tempView;
                    await tick();
                    view = finalView;
                    await tick();
                    goToToday();
                }
            } else {
                loginError = data.error || "Innlogging feilet.";
            }
        } catch (error) {
            console.error('Login error:', error);
            loginError = "Kunne ikke koble til server.";
        } finally {
            isLoading = false;
        }
    }

    // Søk etter utøver basert på navn (admin)
    async function searchUtoverByName() {
        const searchName = currentUtoverNavn.trim();
        if (!searchName) {
            loginError = "Skriv inn et navn";
            return;
        }

        loginError = "";
        isLoading = true;

        try {
            const response = await fetch('/api/admin-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    searchName: searchName
                })
            });

            const data = await response.json();

            if (data.success) {
                currentUtoverNavn = data.searchName;
                currentEditPlanSheet = data.editPlanSheet || "";  // LEGG TIL DENNE
                await Promise.all([
                    loadWorkoutPlan(data.sheetUrl), 
                    loadFellesOkter()
                ]);
                const finalView = view;
                view = finalView === VIEWS.OVERVIEW ? VIEWS.CALENDAR : VIEWS.OVERVIEW;
                await tick();
                view = finalView;
                selectedDate = null;
                view = VIEWS.OVERVIEW;
            } else {
                loginError = data.error || `Finner ingen utøver med navn: ${searchName}`;
            }
        } catch (error) {
            console.error('Search error:', error);
            loginError = "Kunne ikke koble til server.";
        } finally {
            isLoading = false;
        }
    }

    // Håndterer utlogging
    async function handleLogout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        loggedIn = false;
        username = "";
        password = "";
        loginError = "";
        isLoading = false;
        isAdmin = false;
        currentUtoverNavn = "";
        currentEditPlanSheet = "";
        workouts = [];
        fellesOkter = [];
        expandedDates.clear();
        selectedDate = null;
        calendarCursor = startOfMonth(new Date());
        view = VIEWS.OVERVIEW;
    }

    // CSV-lasting
    async function loadWorkoutPlan(sheetUrl: string) {
        try {
            // Bruk sheetUrl direkte istedenfor lokal fil
            const response = await fetch(sheetUrl);
            
            if (!response.ok) {
                loginError = `Kunne ikke laste regneark. Sjekk at lenken er riktig og at regnearket er delt som "Alle med lenken kan se".`;
                return;
            }

            const csvText = await response.text();

            Papa.parse(csvText, {
                header: false,
                skipEmptyLines: true,
                complete: (result) => {
                    const rows = result.data as string[][];
                    if (rows.length < 2) return;

                    const header = rows[0].map((h) => h.trim().toLowerCase());
                    const parsed: Workout[] = [];

                    const idxDato = header.findIndex((h) => h.includes("dato"));
                    const idxHva1 = header.findIndex((h) =>
                        h.includes("hva økt 1"),
                    );
                    const idxTid1 = header.findIndex((h) => h === "tid");
                    const idxHva2 = header.findIndex((h) =>
                        h.includes("hva økt 2"),
                    );
                    const idxTid2 = header.findIndex(
                        (h, i) => h === "tid" && i > idxTid1,
                    );
                    const idxKommentar = header.findIndex((h) =>
                        h.includes("kommentar"),
                    );

                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const dato = parseDate(row[idxDato]);
                        const kommentar =
                            idxKommentar >= 0
                                ? (row[idxKommentar]?.trim() ?? "")
                                : "";

                        if (row[idxHva1]) {
                            parsed.push({
                                date: dato,
                                title: row[idxHva1].trim(),
                                durationMin: toMin(row[idxTid1]),
                                description: kommentar,
                            });
                        }

                        if (idxHva2 >= 0 && row[idxHva2]) {
                            const tid2 = idxTid2 >= 0 ? row[idxTid2] : "";
                            parsed.push({
                                date: dato,
                                title: row[idxHva2].trim(),
                                durationMin: toMin(tid2),
                                description: kommentar,
                            });
                        }
                    }

                    workouts = parsed.filter((w) => w.date);
                },
            });
        } catch (e) {
            console.error("Feil ved lasting av plan:", e);
            loginError =
                "En uventet feil oppstod under lasting av treningsplanen. Sjekk at regnearket er delt offentlig.";
        }
    }

    // Last inn felles økter CSV
    async function loadFellesOkter() {
        try {
            // Hent URL fra backend først
            const urlResponse = await fetch('/api/felles-okter-url');
            const urlData = await urlResponse.json();
            
            const response = await fetch(urlData.url);
            
            if (!response.ok) {
                console.warn("Kunne ikke laste felles økter fra Google Sheets");
                return;
            }

            const csvText = await response.text();

            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: (result) => {
                    const rows = result.data as any[];
                    const parsed: Array<{
                        dato: string;
                        okt: string;
                        utovere: string[];
                    }> = [];

                    rows.forEach((row) => {
                        const dato = row.Dato || row.dato || row.DATO;
                        const okt = row.Økt || row.økt || row.ØKT || row.Okt;
                        const utovere =
                            row.Utøvere ||
                            row.utøvere ||
                            row.UTØVERE ||
                            row.Utovere;

                        if (dato && okt && utovere) {
                            const parsedDato = parseDate(dato);
                            const utovereList = utovere
                                .split(",")
                                .map((n: string) => n.trim())
                                .filter((n: string) => n.length > 0);

                            if (parsedDato && utovereList.length > 0) {
                                parsed.push({
                                    dato: parsedDato,
                                    okt: okt.trim(),
                                    utovere: utovereList,
                                });
                            }
                        }
                    });

                    fellesOkter = parsed;
                },
            });
        } catch (e) {
            console.error("Feil ved lasting av felles økter:", e);
        }
    }

    // Hjelpefunksjon for å finne felles utøvere for en spesifikk økt
    function getFellesUtovere(date: string, sessionTitle: string): string[] {
        const currentUser = isAdmin
            ? currentUtoverNavn.trim()
            : username.trim();

        if (!currentUser || !sessionTitle) {
            return [];
        }

        const matching = fellesOkter.filter(
            (fo) =>
                fo.dato === date &&
                fo.okt.toLowerCase() === sessionTitle.toLowerCase(),
        );

        const allUtovere = new Set<string>();
        matching.forEach((fo) => {
            const hasUser = fo.utovere.some(
                (u) => u.toLowerCase() === currentUser.toLowerCase(),
            );

            if (hasUser) {
                fo.utovere.forEach((u) => {
                    if (u.toLowerCase() !== currentUser.toLowerCase()) {
                        allUtovere.add(u);
                    }
                });
            }
        });

        return Array.from(allUtovere).sort();
    }

    // Toggle funksjon for dropdown
    function toggleExpanded(date: string) {
        if (expandedDates.has(date)) {
            expandedDates.delete(date);
        } else {
            expandedDates.add(date);
        }
        expandedDates = expandedDates;
    }

    // Typer og visninger
    type Workout = {
        date: string;
        title: string;
        durationMin?: number;
        description?: string;
    };

    const VIEWS = {
        OVERVIEW: "overview",
        CALENDAR: "calendar",
        TECHNIQUE: "technique",
        STATISTICS: "statistics",
    } as const;

    type View = (typeof VIEWS)[keyof typeof VIEWS];
    let view: View = VIEWS.OVERVIEW;
    // Statistikk state
    let statsPeriod: "week" | "month" | "year" = "month";
    let statsStartDate = startOfMonth(new Date());
    let showStatsCalendar = false;
    let statsCalendarCursor = new Date();
    let statsCalendarDays: (Date | null)[] = [];

    let workouts: Workout[] = [];
    let today = startOfDay(new Date());
    let selectedDate: Date | null = null;
    let calendarCursor = startOfMonth(new Date());
    let windowMode: "next" | "prev" = "next";

    // Hjelpefunksjoner
    function toMin(t: string): number {
        if (!t) return 0;
        const [h, m] = t.split(":").map((x) => parseInt(x) || 0);
        return h * 60 + m;
    }

    function formatTime(mins: number): string {
        if (!mins) return "";
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h > 0 && m > 0) return `${h}t ${m}min`;
        if (h > 0) return `${h}t`;
        if (m > 0) return `${m}min`;
        return "";
    }

    function getWorkoutInfo(title: string) {
        const lower = title.toLowerCase();
        if (lower.includes("intervall"))
            return {
                icon: Timer,
                color: "bg-red-100 text-red-700",
                iconBg: "bg-red-100",
                iconColor: "text-red-700",
                label: "Intervall",
                italic: false,
            };
        const isHardKeyword =
            lower.includes("motbakkeløp") ||
            lower.includes("sprint") || 
            lower.includes("sprintøkt") ||
            lower.includes("distanseøkt");
        const isRace = 
            /(rennet|(?<!lang)renn(?!forbered))/u.test(lower) ||
            lower.includes("dsv-cup") ||
            lower.includes("km ") ||
            lower.includes(" km")||
            lower.includes("birken")||
            lower.includes("klubbmesterskap") ||
            lower.includes("skifestival");

        if (isHardKeyword || isRace) {
            return {
                icon: Timer,
                color: "bg-red-100 text-red-700",
                iconBg: "bg-red-100",
                iconColor: "text-red-700",
                label: "Hardt",
                italic: false,
            };
        }

        if (lower.includes("hvile"))
            return {
                icon: BatteryCharging,
                color: "bg-green-100 text-green-800",
                iconBg: "bg-green-100",
                iconColor: "text-green-800",
                label: "Hvile",
                italic: false,
            };
        if (lower.includes("langtur"))
            return {
                icon: Heart,
                color: "bg-cyan-100 text-cyan-800",
                iconBg: "bg-cyan-100",
                iconColor: "text-cyan-800",
                label: "Langtur i1",
                italic: false,
            };
        if (lower.includes("hurtighet"))
            return {
                icon: Zap,
                color: "bg-slate-100 text-violet-600 border border-slate-200",
                label: "Hurtighet",
                italic: false,
            };
        if (lower.includes("teknikk"))
            return {
                icon: BookOpen,
                color: "bg-slate-100 text-violet-600 border border-slate-200",
                label: "Teknikk",
                italic: false,
            };
        if (lower.includes("styrke"))
            return {
                icon: Dumbbell,
                color: "bg-yellow-100 text-yellow-800",
                iconBg: "bg-yellow-100",
                iconColor: "text-yellow-800",
                label: "Styrke",
                italic: false,
            };
        if (lower.includes("rennforberedende"))
            return {
                icon: Heart,
                color: "bg-slate-100 text-violet-600 border border-slate-200",
                label: "Forberedelser",
                italic: false,
            };
        return {
            icon: Heart,
            color: "bg-slate-100 text-violet-600 border border-slate-200",
            label: "Rolig i1",
            italic: false,
        };
    }


    function parseDate(str: string) {
        if (!str) return "";
        const clean = str.trim().toLowerCase();
        
        // Prøv først å parse med fullt år (dd.MM.yyyy format)
        const parts = clean.split(".");
        if (parts.length >= 3) {
            const day = parts[0].padStart(2, "0");
            const month = parts[1].padStart(2, "0");
            const year = parts[2].trim();
            
            const parsed = parse(
                `${day}.${month}.${year}`,
                "dd.MM.yyyy",
                new Date(),
                { locale: nb },
            );
            
            if (!isNaN(parsed.getTime())) {
                return format(startOfDay(parsed), "yyyy-MM-dd");
            }
        }
        
        // Fallback: Prøv å parse med månedsnavn (d. MMMM format)
        const cleanWithSpace = clean.replace(/(\d+)\.(\p{L}+)/u, "$1. $2");
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        
        let parsed = parse(
            `${cleanWithSpace} ${currentYear}`,
            "d. MMMM yyyy",
            new Date(),
            { locale: nb },
        );
        
        if (isNaN(parsed.getTime())) {
            // Prøv dd.MM format uten år
            if (parts.length >= 2) {
                const day = parts[0].padStart(2, "0");
                const month = parts[1].padStart(2, "0");
                parsed = parse(
                    `${day}.${month}.${currentYear}`,
                    "dd.MM.yyyy",
                    new Date(),
                    { locale: nb },
                );
            }
        }
        
        if (isNaN(parsed.getTime())) return "";
        
        const parsedMonth = parsed.getMonth();
        
        // Sesonglogikk: Mai (4) til April (3) neste år
        if (currentMonth >= 4) {
            if (parsedMonth <= 3) {
                parsed = new Date(currentYear + 1, parsedMonth, parsed.getDate());
            }
        } else {
            if (parsedMonth >= 4) {
                parsed = new Date(currentYear - 1, parsedMonth, parsed.getDate());
            }
        }
        
        return format(startOfDay(parsed), "yyyy-MM-dd");
    }

    function endOfDayIncl(d: Date) {
        const endOfDay = new Date(d);
        endOfDay.setHours(23, 59, 59, 999);
        return endOfDay;
    }

    // Dato-logikk
    $: activeDate = selectedDate ? selectedDate : today;
    $: activeIso = format(activeDate, "yyyy-MM-dd");
    $: activeWorkouts = workouts.filter((w) => w.date === activeIso);
    $: windowDates =
        windowMode === "next"
            ? { start: addDays(activeDate, 1), end: addDays(activeDate, 6) }
            : { start: subDays(activeDate, 7), end: subDays(activeDate, 1) };

    $: windowWorkouts = workouts
        .filter((w) => {
            const d = parseISO(w.date);
            return (
                !isSameDay(d, activeDate) &&
                isWithinInterval(d, {
                    start: startOfDay(windowDates.start),
                    end: endOfDayIncl(windowDates.end),
                })
            );
        })
        .sort((a, b) => {
            return windowMode === ("prev" as typeof windowMode)
                ? b.date.localeCompare(a.date)
                : a.date.localeCompare(b.date);
        });

    // Reaktiv blokk for å sikre at felles utøvere oppdateres
    $: {
        if (username.trim() && fellesOkter.length > 0 && loggedIn) {
            expandedDates = expandedDates;
        }
    }

    // Kalender
    function changeMonth(dir: "next" | "prev") {
        calendarCursor =
            dir === "next"
                ? addMonths(calendarCursor, 1)
                : subMonths(calendarCursor, 1);
    }

    $: {
        const monthStart = startOfMonth(calendarCursor);
        const monthEnd = endOfMonth(calendarCursor);
        const startWeekday = (getDay(monthStart) + 6) % 7;
        const totalDays = monthEnd.getDate();

        days = [];
        for (let i = 0; i < startWeekday; i++) days.push(null);
        for (let d = 0; d < totalDays; d++) days.push(addDays(monthStart, d));
    }

    let days: (Date | null)[] = [];

    function selectDay(d: Date) {
        selectedDate = startOfDay(d);
        view = VIEWS.OVERVIEW;
    }

    function goToToday() {
        selectedDate = null;
        calendarCursor = startOfMonth(new Date());
        view = VIEWS.OVERVIEW;
    }

    function groupByDate(list: Workout[]) {
        const map = new Map<string, Workout[]>();
        list.forEach((w) => {
            if (!map.has(w.date)) map.set(w.date, []);
            map.get(w.date)!.push(w);
        });
        return Array.from(map.entries()).map(([date, sessions]) => ({
            date,
            sessions,
        }));
    }

    $: viewTransform =
        view === VIEWS.CALENDAR ? "translateX(100%)" : "translateX(0)";
    $: isCalendarView = view === VIEWS.CALENDAR;

    // Hamburgermeny state
    let menuOpen = false;
    let showStyrkeSubmenu = false;

    // PDF-lenker
    const intensitetssoner = { title: "Intensitetssoner", url: "/pdf/Intensitessoner.pdf" };
    
    const styrkeProgrammer = [
        { title: "Styrke med vekter", url: "/pdf/StyrkeMedVekter.pdf" },
        { title: "Styrke uten vekter", url: "/pdf/StyrkeUtenVekter.pdf" },
        { title: "Styrke vinter", url: "/pdf/StyrkeVinter.pdf" },
        { title: "Kort styrkeøkt overkropp", url: "/pdf/KortStyrkeøktOverkropp.pdf" },
        { title: "Kort styrkeøkt ben", url: "/pdf/KortStyrkeøktBen.pdf" },
    ];

    function toggleMenu() {
        menuOpen = !menuOpen;
        if (!menuOpen) {
            showStyrkeSubmenu = false;
        }
    }

    function openPdf(url: string) {
        window.open(url, '_blank');
        menuOpen = false;
        showStyrkeSubmenu = false;
    }

    function showStyrkeMenu() {
        showStyrkeSubmenu = true;
    }

    function backToMainMenu() {
        showStyrkeSubmenu = false;
    }

    // Statistikkfunksjoner
    function getPeriodDates(period: typeof statsPeriod, startDate: Date) {
        switch (period) {
            case "week":
                return {
                    start: startOfWeek(startDate, { weekStartsOn: 1 }),
                    end: endOfWeek(startDate, { weekStartsOn: 1 })
                };
            case "month":
                return {
                    start: startOfMonth(startDate),
                    end: endOfMonth(startDate)
                };
            case "year":
                const currentYear = startDate.getFullYear();
                const isAfterMay = startDate.getMonth() >= 4; // Mai er index 4
                const seasonStartYear = isAfterMay ? currentYear : currentYear - 1;
                
                return {
                    start: new Date(seasonStartYear, 4, 1), // 1. mai
                    end: new Date(seasonStartYear + 1, 3, 30, 23, 59, 59) // 30. april neste år
                };
        }
    }

    function changePeriod(direction: "next" | "prev") {
        switch (statsPeriod) {
            case "week":
                statsStartDate = direction === "next" 
                    ? addWeeks(statsStartDate, 1) 
                    : subWeeks(statsStartDate, 1);
                break;
            case "month":
                statsStartDate = direction === "next" 
                    ? addMonths(statsStartDate, 1) 
                    : subMonths(statsStartDate, 1);
                break;
            case "year":
                statsStartDate = direction === "next" 
                    ? addYears(statsStartDate, 1) 
                    : subYears(statsStartDate, 1);
                break;
        }
    }

    function getPeriodLabel(period: typeof statsPeriod, startDate: Date): string {
        switch (period) {
            case "week":
                const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
                const weekEnd = endOfWeek(startDate, { weekStartsOn: 1 });
                return `Uke ${format(weekStart, "w, yyyy", { locale: nb })}`;
            case "month":
                return format(startDate, "MMMM yyyy", { locale: nb });
            case "year":
                const currentYear = startDate.getFullYear();
                const isAfterMay = startDate.getMonth() >= 4;
                const startYear = isAfterMay ? currentYear : currentYear - 1;
                return `${startYear}/${startYear + 1}`;
        }
    }

    $: periodDates = getPeriodDates(statsPeriod, statsStartDate);
    $: periodWorkouts = workouts.filter((w) => {
        const d = parseISO(w.date);
        return isWithinInterval(d, {
            start: startOfDay(periodDates.start),
            end: endOfDayIncl(periodDates.end),
        });
    });

    $: stats = (() => {
        let hardOkter = 0;
        let langtur = 0;
        let styrke = 0;
        let hvile = 0;
        let totalMinutes = 0;

        periodWorkouts.forEach((w) => {
            const lower = w.title.toLowerCase();
            
            // Kategorisering
            if (lower.includes("hvile")) {
                hvile++;
            } else if (lower.includes("styrke")) {
                styrke++;
            } else if (lower.includes("langtur")) {
                langtur++;
            } else {
                // Sjekk om det er hardøkt
                const isHard = lower.includes("intervall") ||
                    lower.includes("motbakkeløp") ||
                    lower.includes("sprint") ||
                    lower.includes("sprintøkt") ||
                    lower.includes("distanseøkt") ||
                    /(rennet|(?<!lang)renn(?!forbered))/u.test(lower) ||
                    lower.includes("dsv-cup") ||
                    lower.includes("km ") ||
                    lower.includes(" km") ||
                    lower.includes("birken") ||
                    lower.includes("klubbmesterskap") ||
                    lower.includes("skifestival");
                
                if (isHard) {
                    hardOkter++;
                }
            }
            
            if (w.durationMin) {
                totalMinutes += w.durationMin;
            }
        });

        const totalHours = Math.floor(totalMinutes / 60);
        const totalMins = totalMinutes % 60;

        return {
            hardOkter,
            langtur,
            styrke,
            hvile,
            totalEconomic: periodWorkouts.length - hvile, // Alle økter unntatt hvile
            totalHours,
            totalMins,
            totalMinutes
        };
    })();    

    // Kalenderdialog-funksjoner
    function openStatsCalendar() {
        showStatsCalendar = true;
        statsCalendarCursor = statsStartDate;
        updateStatsCalendarDays();
    }

    function closeStatsCalendar() {
        showStatsCalendar = false;
    }

    function updateStatsCalendarDays() {
        const monthStart = startOfMonth(statsCalendarCursor);
        const monthEnd = endOfMonth(statsCalendarCursor);
        const startWeekday = (getDay(monthStart) + 6) % 7;
        const totalDays = monthEnd.getDate();

        statsCalendarDays = [];
        for (let i = 0; i < startWeekday; i++) statsCalendarDays.push(null);
        for (let d = 0; d < totalDays; d++) statsCalendarDays.push(addDays(monthStart, d));
    }

    function changeStatsCalendarMonth(dir: "next" | "prev") {
        statsCalendarCursor = dir === "next" 
            ? addMonths(statsCalendarCursor, 1) 
            : subMonths(statsCalendarCursor, 1);
        updateStatsCalendarDays();
    }

    function selectStatsDate(date: Date) {
        if (statsPeriod === "week") {
            statsStartDate = startOfWeek(date, { weekStartsOn: 1 });
        } else if (statsPeriod === "month") {
            statsStartDate = startOfMonth(date);
        } else {
            const isAfterMay = date.getMonth() >= 4;
            const seasonStartYear = isAfterMay ? date.getFullYear() : date.getFullYear() - 1;
            statsStartDate = new Date(seasonStartYear, 4, 1);
        }
        closeStatsCalendar();
    }

    // Oppdater kalenderdager når cursor endres
    $: if (showStatsCalendar) {
        updateStatsCalendarDays();
    }
</script>

{#if !loggedIn}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-95 p-4"
    >
        <div
            class="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl transition-all duration-500 ease-in-out transform scale-100"
        >
            <h2 class="mb-6 text-center text-3xl font-bold text-violet-700">
                Treningsplan
            </h2>

            <div class="mb-4">
                <label
                    for="username"
                    class="mb-2 flex items-center text-sm font-medium text-gray-700"
                >
                    <User class="mr-2 h-4 w-4" /> Brukernavn
                </label>
                <input
                    id="username"
                    type="text"
                    bind:value={username}
                    disabled={isLoading}
                    class="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg focus:border-violet-500 focus:ring-violet-500 disabled:bg-gray-100"
                />
            </div>

            <div class="mb-6">
                <label
                    for="password"
                    class="mb-2 flex items-center text-sm font-medium text-gray-700"
                >
                    <Lock class="mr-2 h-4 w-4" /> Passord
                </label>
                <input
                    id="password"
                    type="password"
                    bind:value={password}
                    disabled={isLoading}
                    on:keydown={(e) => {
                        if (e.key === "Enter") handleLogin();
                    }}
                    class="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg focus:border-violet-500 focus:ring-violet-500 disabled:bg-gray-100"
                />
            </div>

            {#if loginError}
                <div
                    class="mb-4 rounded-lg bg-red-100 p-3 text-sm font-medium text-red-700"
                >
                    {loginError}
                </div>
            {/if}

            <button
                on:click={handleLogin}
                disabled={isLoading || !username || !password}
                class="flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-lg font-semibold text-white shadow-md transition-colors hover:bg-violet-700 disabled:bg-violet-300"
            >
                {#if isLoading}
                    <svg
                        class="mr-3 h-5 w-5 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                        ></circle>
                        <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                    </svg>
                    Logger inn...
                {:else}
                    Logg inn
                {/if}
            </button>
        </div>
    </div>
{/if}

{#if loggedIn}
    <div class="min-h-screen bg-slate-50">
        <div class="bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white">
            <div class="mx-auto max-w-5xl px-4 py-8">
                <!-- Øverste rad: H1 og Hamburgermeny (PC) / H1 og Hamburgermeny (Mobil) -->
                <div class="flex justify-between items-center mb-4 sm:mb-6 relative">
                    <h1 class="text-3xl sm:text-5xl font-bold">TRENINGSPLAN</h1>

                    <!-- Hamburgermeny knapp -->
                    <button
                        on:click={toggleMenu}
                        class="bg-white/20 hover:bg-white/30 p-2 rounded-xl transition-colors relative"
                        aria-label="Meny"
                    >
                        <div class="w-6 h-6 flex flex-col justify-center items-center relative">
                            <span
                                class="absolute w-6 h-0.5 bg-white rounded-full transition-all duration-600 ease-out"
                                class:rotate-45={menuOpen}
                                class:-translate-y-2={!menuOpen}
                            ></span>
                            <span
                                class="absolute w-6 h-0.5 bg-white rounded-full transition-all duration-600 ease-out"
                                class:opacity-0={menuOpen}
                                class:scale-0={menuOpen}
                            ></span>
                            <span
                                class="absolute w-6 h-0.5 bg-white rounded-full transition-all duration-600 ease-out"
                                class:-rotate-45={menuOpen}
                                class:translate-y-2={!menuOpen}
                            ></span>
                        </div>
                    </button>

                    <!-- Dropdown meny -->
                    {#if menuOpen}
                        <div class="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-2xl border border-violet-200 min-w-[250px] z-50 overflow-hidden">
                            {#if !showStyrkeSubmenu}
                                <!-- Hovedmeny -->
                                <div class="py-2">
                                    <div class="px-4 py-2 text-sm font-semibold text-violet-700 border-b border-violet-100">
                                        Meny
                                    </div>
                                    
                                    {#if currentEditPlanSheet}
                                        <button
                                            on:click={() => {
                                                window.open(currentEditPlanSheet, '_blank');
                                                menuOpen = false;
                                            }}
                                            class="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors text-slate-700 font-medium flex items-center gap-2 border-b border-violet-100"
                                        >
                                            <svg class="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                                            </svg>
                                            {isAdmin && currentUtoverNavn ? `${currentUtoverNavn} treningsplan (Rediger)` : 'Min treningsplan (Rediger)'}
                                        </button>
                                    {/if}
                                    
                                    <button
                                        on:click={() => {
                                            view = VIEWS.TECHNIQUE;
                                            menuOpen = false;
                                        }}
                                        class="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors text-slate-700 font-medium flex items-center gap-2 border-b border-violet-100"
                                    >
                                        <Video class="h-5 w-5 text-violet-600" />
                                        Teknikkvideoer
                                    </button>

                                    <button
                                        on:click={showStyrkeMenu}
                                        class="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors text-slate-700 font-medium flex items-center gap-2 border-b border-violet-100"
                                    >
                                        <Dumbbell class="h-5 w-5 text-violet-600" />
                                        Styrkeøkter
                                        <ChevronRight class="h-4 w-4 ml-auto text-slate-400" />
                                    </button>

                                    <button
                                        on:click={() => openPdf(intensitetssoner.url)}
                                        class="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors text-slate-700 font-medium flex items-center gap-2"
                                    >
                                        <svg class="h-5 w-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                                        </svg>
                                        Intensitetssoner
                                    </button>
                                </div>
                            {:else}
                                <!-- Styrkeøkter undermeny -->
                                <div class="py-2">
                                    <div class="flex items-center px-4 py-2 border-b border-violet-100">
                                        <button
                                            on:click={backToMainMenu}
                                            class="flex items-center gap-2 text-violet-700 hover:text-violet-800 transition-colors"
                                        >
                                            <ArrowLeft class="h-4 w-4" />
                                            <span class="text-sm font-semibold">Tilbake</span>
                                        </button>
                                    </div>

                                    <div class="px-4 py-2 text-sm font-semibold text-violet-700 border-b border-violet-100">
                                        Styrkeøkter
                                    </div>

                                    {#each styrkeProgrammer as program}
                                        <button
                                            on:click={() => openPdf(program.url)}
                                            class="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors text-slate-700 font-medium flex items-center gap-2"
                                        >
                                            <svg class="h-5 w-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                                            </svg>
                                            {program.title}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Admin søkefelt (hvis admin) -->
                {#if isAdmin}
                    <div class="mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full">
                        <div class="flex-1 flex gap-2 w-full">
                            <input
                                type="text"
                                bind:value={currentUtoverNavn}
                                on:keydown={(e) => {
                                    if (e.key === "Enter") searchUtoverByName();
                                }}
                                placeholder="Søk etter utøvernavn..."
                                class="flex-1 rounded-full border-0 bg-white/20 px-4 py-2 text-white placeholder-white/60 font-medium focus:bg-white/30 focus:ring-2 focus:ring-white/50"
                            />
                            <button
                                on:click={searchUtoverByName}
                                disabled={isLoading || !currentUtoverNavn.trim()}
                                class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {#if isLoading}
                                    <svg
                                        class="h-4 w-4 animate-spin"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            class="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            stroke-width="4"
                                        ></circle>
                                        <path
                                            class="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        ></path>
                                    </svg>
                                {:else}
                                    <User class="h-4 w-4" />
                                {/if}
                                Søk
                            </button>
                        </div>
                    </div>

                    {#if loginError}
                        <div class="mb-3 rounded-lg bg-red-500/90 p-3 text-sm font-medium text-white">
                            {loginError}
                        </div>
                    {/if}
                {/if}

                <!-- Logg ut (mobil - over slider) -->
                <div class="sm:hidden mb-4 flex justify-start">
                    <button
                        on:click={handleLogout}
                        class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-xl text-sm font-medium transition-colors flex items-center gap-1"
                    >
                        <Lock class="h-4 w-4" /> Logg ut
                    </button>
                </div>

                <!-- Nederste rad: Logg ut (PC) og Slider -->
                <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 sm:gap-4">
                    <!-- Logg ut (desktop - venstre side) -->
                    <button
                        on:click={handleLogout}
                        class="hidden sm:flex bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-xl text-sm font-medium transition-colors items-center gap-1"
                    >
                        <Lock class="h-4 w-4" /> Logg ut
                    </button>

                    <!-- Slider (høyre side på PC, full bredde på mobil) -->
                    <div class="flex justify-end w-full sm:w-auto">
                        <div
                            class="relative flex bg-white/15 rounded-full w-full sm:w-[345px]"
                            style="padding: 0.175rem;">
                            <div
                                class="absolute rounded-full transition-all {view === VIEWS.TECHNIQUE ? 'bg-transparent' : 'duration-[700ms] bg-white shadow-md'}"
                                style={`top: 0.175rem; left: 0.175rem; height: calc(100% - 0.35rem); width: calc(33.333% - 0.38rem); transform: translateX(${
                                    view === VIEWS.OVERVIEW
                                        ? "0"
                                        : view === VIEWS.CALENDAR
                                        ? "calc(100% + 0.35rem)"
                                        : "calc(200% + 0.7rem)"
                                });`}
                            ></div>

                            <button
                                on:click={() => (view = VIEWS.OVERVIEW)}
                                class={`relative z-10 w-1/3 py-2 text-sm font-medium flex items-center justify-center transition-colors ${
                                    view === VIEWS.OVERVIEW
                                        ? "text-violet-600"
                                        : "text-white/80 hover:text-white"
                                }`}
                            >
                                <NotepadText class="h-4 w-4 mr-1" /> Plan
                            </button>
                            <button
                                on:click={() => (view = VIEWS.CALENDAR)}
                                class={`relative z-10 w-1/3 py-2 text-sm font-medium flex items-center justify-center transition-colors ${
                                    view === VIEWS.CALENDAR
                                        ? "text-violet-600"
                                        : "text-white/80 hover:text-white"
                                }`}
                            >
                                <Calendar class="h-4 w-4 mr-1" /> Kalender
                            </button>
                            <button
                                on:click={() => (view = VIEWS.STATISTICS)}
                                class={`relative z-10 w-1/3 py-2 text-sm font-medium flex items-center justify-center transition-colors ${
                                    view === VIEWS.STATISTICS
                                        ? "text-violet-600"
                                        : "text-white/80 hover:text-white"
                                }`}
                                >
                                    <LineChart class="h-4 w-4 mr-1" /> Statistikk
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="mx-auto max-w-5xl px-4 py-6 sm:py-8">
            {#if view === VIEWS.OVERVIEW}
                <h2 class="mb-3 text-2xl font-semibold">
                    {#if selectedDate}
                        {format(selectedDate, "EEEE d. MMMM", { locale: nb })}
                    {:else}
                        I dag
                    {/if}
                </h2>
            {/if}

            {#if view === VIEWS.OVERVIEW && activeWorkouts.length > 0}
                {#each groupByDate(activeWorkouts) as g}
                    {@const isDoubleSession = g.sessions.length >= 2}
                    {@const s1Title = g.sessions[0]?.title || "Økt 1"}
                    {@const s2Title = g.sessions[1]?.title || "Økt 2"}
                    {@const fellesUtovere1 = getFellesUtovere(g.date, s1Title)}
                    {@const fellesUtovere2 = isDoubleSession
                        ? getFellesUtovere(g.date, s2Title)
                        : []}
                    {@const uniqueFellesUtovere = Array.from(
                        new Set([...fellesUtovere1, ...fellesUtovere2]),
                    )}
                    {@const totalCount = uniqueFellesUtovere.length}
                    {@const isRestDay = g.sessions.some((s) =>
                        s.title.toLowerCase().includes("hvile"),
                    )}

                    <div class="rounded-2xl border border-violet-500 bg-white shadow-sm mb-3 overflow-hidden">
                        <div class="bg-violet-50 py-3 border-b border-violet-500">
                            <p class="text-slate-900 font-semibold text-base sm:text-lg px-4">
                            <span class="capitalize"> {format(parseISO(g.date), "EEEE", { locale: nb })} </span> {" "} {format(parseISO(g.date), "d.MMMM", { locale: nb })}
                            </p>
                        </div>
                        <div class="p-4">
                            <div class="mb-1 grid gap-y-5">
                                {#each g.sessions as s}
                                    {#key s}
                                        {#await Promise.resolve(getWorkoutInfo(s.title)) then info}
                                            <div
                                                class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0 w-full"
                                            >
                                                <div
                                                    class="flex items-stretch gap-3 w-full"
                                                >
                                                    <div
                                                        class={`flex items-center justify-center w-12 h-12 sm:w-13 sm:h-13 rounded-xl shrink-0 ${info.iconBg ?? "bg-slate-100"}`}
                                                    >
                                                        <svelte:component
                                                            this={info.icon}
                                                            class={`h-8 w-8 sm:h-6 sm:w-6 ${info.iconColor ?? "text-violet-600"}`}
                                                        />
                                                    </div>

                                                    <div
                                                        class="flex flex-col justify-between w-full min-w-0 h-12 sm:h-13"
                                                    >
                                                        <div
                                                            class="text-slate-800 text-[15px] sm:text-lg font-semibold leading-tight"
                                                        >
                                                            {s.title}
                                                        </div>

                                                        <div
                                                            class="flex items-center flex-wrap gap-x-1 leading-none mt-[1px]"
                                                        >
                                                            <div
                                                                class={`flex items-center px-2 py-[2px] rounded-full text-[13px] sm:text-[14px] font-medium gap-1 ${info.color} ${info.italic ? "italic" : ""}`}
                                                            >
                                                                <svelte:component
                                                                    this={info.icon}
                                                                    class="h-[15px] w-[15px]"
                                                                />
                                                                {info.label}
                                                            </div>

                                                            {#if s.durationMin}
                                                                <div
                                                                    class="flex items-center text-[13px] sm:text-[14px] text-slate-600 mt-[1px]"
                                                                >
                                                                    <Clock
                                                                        class="inline h-[15px] w-[15px] mr-0.5 text-slate-500"
                                                                    />
                                                                    {formatTime(
                                                                        s.durationMin,
                                                                    )}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        {/await}
                                    {/key}
                                {/each}
                            </div>

                            {#if g.sessions[0].description}
                                <p class="mt-3 text-slate-700">
                                    {g.sessions[0].description}
                                </p>
                            {/if}

                            {#if !isRestDay}
                                <button
                                    on:click={() => toggleExpanded(g.date)}
                                    class="mt-3 flex items-center gap-2 text-violet-600 hover:text-violet-700 font-medium text-sm transition-colors w-full"
                                >
                                    <Users class="h-4 w-4" />
                                    {#if totalCount > 0}
                                        {totalCount}
                                        {totalCount === 1
                                            ? "person har"
                                            : "personer har"} samme økt{isDoubleSession
                                            ? "er"
                                            : ""}
                                    {:else}
                                        Finner ingen med lik økt
                                    {/if}
                                    {#if expandedDates.has(g.date)}
                                        <ChevronUp class="h-4 w-4 ml-auto" />
                                    {:else}
                                        <ChevronDown class="h-4 w-4 ml-auto" />
                                    {/if}
                                </button>

                                {#if expandedDates.has(g.date)}
                                    <div class="mt-2 bg-violet-50 rounded-lg p-3">
                                        {#if isDoubleSession}
                                            {#if fellesUtovere1.length > 0}
                                                <p
                                                    class="text-sm font-semibold mb-2 text-slate-700"
                                                >
                                                    Økt 1:
                                                </p>
                                                <div
                                                    class="flex flex-wrap gap-2 mb-3 pb-3 border-b border-violet-200"
                                                >
                                                    {#each fellesUtovere1 as utover}
                                                        <div
                                                            class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                        >
                                                            {utover}
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <p
                                                    class="text-sm font-semibold mb-2 text-slate-700"
                                                >
                                                    Økt 1:
                                                </p>
                                                <p
                                                    class="text-sm text-slate-600 italic mb-3 pb-3 border-b border-violet-200"
                                                >
                                                    Ingen andre har denne økten.
                                                </p>
                                            {/if}

                                            {#if fellesUtovere2.length > 0}
                                                <p
                                                    class="text-sm font-semibold mb-2 text-slate-700"
                                                >
                                                    Økt 2:
                                                </p>
                                                <div class="flex flex-wrap gap-2">
                                                    {#each fellesUtovere2 as utover}
                                                        <div
                                                            class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                        >
                                                            {utover}
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <p
                                                    class="text-sm font-semibold mb-2 text-slate-700"
                                                >
                                                    Økt 2:
                                                </p>
                                                <p
                                                    class="text-sm text-slate-600 italic"
                                                >
                                                    Ingen andre har denne økten.
                                                </p>
                                            {/if}
                                        {:else if fellesUtovere1.length > 0}
                                            <div class="flex flex-wrap gap-2">
                                                {#each fellesUtovere1 as utover}
                                                    <div
                                                        class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                    >
                                                        {utover}
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p
                                                class="text-sm text-slate-600 italic"
                                            >
                                                Ingen andre er satt opp med denne økten.
                                            </p>
                                        {/if}
                                    </div>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {/each}
            {:else if view === VIEWS.OVERVIEW}
                <div
                    class="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-slate-600"
                >
                    Ingen planlagt økt for denne dagen.
                </div>
            {/if}

            {#if view === VIEWS.OVERVIEW}
                <div
                    class="relative mt-6 flex bg-slate-200 rounded-full w-[270px]"
                    style="padding: 0.175rem;"
                >
                    <div
                        class="absolute bg-violet-600 rounded-full shadow-sm transition-all duration-[700ms] ease-in-out"
                        style={`top: 0.175rem; left: 0.175rem; height: calc(100% - 0.35rem); width: calc(50% - 0.38rem); transform: translateX(${windowMode === "next" ? "calc(100% + 0.35rem)" : "0"});`}
                    ></div>

                    <button
                        on:click={() => (windowMode = "prev")}
                        class={`relative z-10 w-1/2 text-sm font-medium py-2 transition-all duration-500 ${
                            windowMode === "prev"
                                ? "text-white"
                                : "text-slate-700 hover:text-violet-700"
                        }`}
                    >
                        7 forrige dager
                    </button>

                    <button
                        on:click={() => (windowMode = "next")}
                        class={`relative z-10 w-1/2 text-sm font-medium py-2 transition-all duration-500 ${
                            windowMode === "next"
                                ? "text-white"
                                : "text-slate-700 hover:text-violet-700"
                        }`}
                    >
                        7 neste dager
                    </button>
                </div>
            {/if}

            {#if view === VIEWS.OVERVIEW}
                <h3 class="mt-4 mb-6 text-xl font-semibold">
                    {windowMode === "next"
                        ? "Kommende økter"
                        : "Tidligere økter"}
                </h3>

                {#if windowWorkouts.length === 0}
                    <div
                        class="border border-dashed border-slate-300 rounded-xl p-6 text-slate-600"
                    >
                        Ingen økter i valgt periode.
                    </div>
                {:else}
                    {#each groupByDate(windowWorkouts) as g}
                        {@const isDoubleSession = g.sessions.length >= 2}
                        {@const s1Title = g.sessions[0]?.title || "Økt 1"}
                        {@const s2Title = g.sessions[1]?.title || "Økt 2"}
                        {@const fellesUtovere1 = getFellesUtovere(
                            g.date,
                            s1Title,
                        )}
                        {@const fellesUtovere2 = isDoubleSession
                            ? getFellesUtovere(g.date, s2Title)
                            : []}
                        {@const uniqueFellesUtovere = Array.from(
                            new Set([...fellesUtovere1, ...fellesUtovere2]),
                        )}
                        {@const totalCount = uniqueFellesUtovere.length}
                        {@const isRestDay = g.sessions.some((s) =>
                            s.title.toLowerCase().includes("hvile"),
                        )}

                        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm mb-6 overflow-hidden">
                            <div class="bg-violet-50 py-3">
                                <p class="text-slate-900 font-semibold text-base sm:text-lg px-4">
                                    <span class="capitalize"> {format(parseISO(g.date), "EEEE", { locale: nb })} </span> {" "} {format(parseISO(g.date), "d.MMMM", { locale: nb })}
                                </p>
                            </div>

                            <div class="p-4">
                                <div class="mb-1 grid gap-y-5">
                                    {#each g.sessions as s}
                                        {#key s}
                                            {#await Promise.resolve(getWorkoutInfo(s.title)) then info}
                                                <div
                                                    class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0 w-full"
                                                >
                                                    <div
                                                        class="flex items-stretch gap-3 w-full"
                                                    >
                                                        <div
                                                            class={`flex items-center justify-center w-13 h-13 sm:w-12 sm:h-12 rounded-xl shrink-0 ${info.iconBg ?? "bg-slate-100"}`}
                                                        >
                                                            <svelte:component
                                                                this={info.icon}
                                                                class={`h-8 w-8 sm:h-6 sm:w-6 ${info.iconColor ?? "text-violet-600"}`}
                                                            />
                                                        </div>

                                                        <div
                                                            class="flex flex-col justify-between w-full min-w-0 h-13 sm:h-12"
                                                        >
                                                            <div
                                                                class="text-slate-800 text-[15px] sm:text-lg font-semibold leading-tight"
                                                            >
                                                                {s.title}
                                                            </div>

                                                            <div
                                                                class="flex items-center flex-wrap gap-x-1 leading-none mt-[1px]"
                                                            >
                                                                <div
                                                                    class={`flex items-center px-2 py-[2px] rounded-full text-[13px] sm:text-[14px] font-medium gap-1 ${info.color} ${info.italic ? "italic" : ""}`}
                                                                >
                                                                    <svelte:component
                                                                        this={info.icon}
                                                                        class="h-[15px] w-[15px]"
                                                                    />
                                                                    {info.label}
                                                                </div>

                                                                {#if s.durationMin}
                                                                    <div
                                                                        class="flex items-center text-[13px] sm:text-[14px] text-slate-600 mt-[1px]"
                                                                    >
                                                                        <Clock
                                                                            class="inline h-[15px] w-[15px] mr-0.5 text-slate-500"
                                                                        />
                                                                        {formatTime(
                                                                            s.durationMin,
                                                                        )}
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            {/await}
                                        {/key}
                                    {/each}
                                </div>
                            

                                {#if g.sessions[0].description}
                                    <p class="mt-3 text-slate-700">
                                        {g.sessions[0].description}
                                    </p>
                                {/if}

                                {#if !isRestDay}
                                    <button
                                        on:click={() => toggleExpanded(g.date)}
                                        class="mt-3 flex items-center gap-2 text-violet-600 hover:text-violet-700 font-medium text-sm transition-colors w-full"
                                    >
                                        <Users class="h-4 w-4" />
                                        {#if totalCount > 0}
                                            {totalCount}
                                            {totalCount === 1
                                                ? "person har"
                                                : "personer har"} samme økt{isDoubleSession
                                                ? "er"
                                                : ""}
                                        {:else}
                                            Finner ingen med lik økt
                                        {/if}
                                        {#if expandedDates.has(g.date)}
                                            <ChevronUp class="h-4 w-4 ml-auto" />
                                        {:else}
                                            <ChevronDown class="h-4 w-4 ml-auto" />
                                        {/if}
                                    </button>

                                    {#if expandedDates.has(g.date)}
                                        <div
                                            class="mt-2 bg-violet-50 rounded-lg p-3"
                                        >
                                            {#if isDoubleSession}
                                                {#if fellesUtovere1.length > 0}
                                                    <p
                                                        class="text-sm font-semibold mb-2 text-slate-700"
                                                    >
                                                        Økt 1:
                                                    </p>
                                                    <div
                                                        class="flex flex-wrap gap-2 mb-3 pb-3 border-b border-violet-200"
                                                    >
                                                        {#each fellesUtovere1 as utover}
                                                            <div
                                                                class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                            >
                                                                {utover}
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {:else}
                                                    <p
                                                        class="text-sm font-semibold mb-2 text-slate-700"
                                                    >
                                                        Økt 1:
                                                    </p>
                                                    <p
                                                        class="text-sm text-slate-600 italic mb-3 pb-3 border-b border-violet-200"
                                                    >
                                                        Ingen andre har denne økten.
                                                    </p>
                                                {/if}

                                                {#if fellesUtovere2.length > 0}
                                                    <p
                                                        class="text-sm font-semibold mb-2 text-slate-700"
                                                    >
                                                        Økt 2:
                                                    </p>
                                                    <div
                                                        class="flex flex-wrap gap-2"
                                                    >
                                                        {#each fellesUtovere2 as utover}
                                                            <div
                                                                class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                            >
                                                                {utover}
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {:else}
                                                    <p
                                                        class="text-sm font-semibold mb-2 text-slate-700"
                                                    >
                                                        Økt 2:
                                                    </p>
                                                    <p
                                                        class="text-sm text-slate-600 italic"
                                                    >
                                                        Ingen andre har denne økten.
                                                    </p>
                                                {/if}
                                            {:else if fellesUtovere1.length > 0}
                                                <div class="flex flex-wrap gap-2">
                                                    {#each fellesUtovere1 as utover}
                                                        <div
                                                            class="bg-white px-3 py-1 rounded-full text-sm font-medium text-violet-700 border border-violet-200"
                                                        >
                                                            {utover}
                                                        </div>
                                                    {/each}
                                                </div>
                                            {:else}
                                                <p
                                                    class="text-sm text-slate-600 italic"
                                                >
                                                    Ingen andre er satt opp med denne økten.
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                    {/each}
                {/if}
            {/if}

            {#if view === VIEWS.TECHNIQUE}
                <div class="mt-8 mb-12 mx-auto max-w-6xl px-1 sm:px-4">
                    <h2
                        class="mb-6 text-3xl font-bold text-center text-violet-700"
                    >
                        Teknikkvideoer
                    </h2>

                    <div class="space-y-4">
                        <!-- Klassisk -->
                        <details
                            class="group bg-white rounded-2xl shadow-lg border border-violet-500 overflow-hidden"
                        >
                            <summary
                                class="cursor-pointer px-6 py-4 text-xl font-bold text-violet-700 hover:bg-violet-50 group-open:bg-violet-50 transition-colors flex items-center justify-between"
                            >
                                Klassisk
                                <ChevronDown
                                    class="h-5 w-5 transition-transform group-open:rotate-180 duration-700 ease-out"
                                />
                            </summary>

                            <div class="px-1 sm:px-6 pb-6 space-y-4">
                                <!-- Diagonal -->
                                <details class="group/sub bg-white rounded-2xl mt-4 overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Diagonal
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/Z2oNfG4eulQ?si=K3hgPIcHR19j3CUx"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>

                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/NNR6YpFA7Jw?si=i19W-qDQ-Rv-4TDG" 
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>

                                <!-- Staking -->
                                <details class="group/sub bg-white rounded-2xl overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Staking
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/D_hlp-buPhA?si=dDlDK1h5lWddEDzN"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>

                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/MYVK4agNPcE?si=5L52ljY36n9Z1MZH"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>

                                <!-- Dobbeltak med fraspark -->
                                <details class="group/sub bg-white rounded-2xl overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Dobbeltak med fraspark
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/7SZn1vDG_WY?si=obHl2RpMR8ByMgfz"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>
                            </div>
                        </details>

                        <!-- Skøyting -->
                        <details
                            class="group bg-white rounded-2xl shadow-lg border border-violet-500 overflow-hidden"
                        >
                            <summary
                                class="cursor-pointer px-6 py-4 text-xl font-bold text-violet-700 hover:bg-violet-50 group-open:bg-violet-50 transition-colors flex items-center justify-between"
                            >
                                Skøyting
                                <ChevronDown
                                    class="h-5 w-5 transition-transform group-open:rotate-180 duration-700 ease-out"
                                />
                            </summary>

                            <div class="0 sm:px-6 pb-6 space-y-4">
                                <!-- Dobbeldans -->
                                <details class="group/sub bg-white rounded-2xl mt-4 overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Dobbeldans
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/PlFkOEr7bw0?si=qVwizVGKQVB6ixoA"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>

                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/G-vIb6gzYRk?si=I7mpCV1p-j7vSKv_" 
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>

                                <!-- Padling -->
                                <details class="group/sub bg-white rounded-2xl overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Padling
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/Z6ynMU7KixA?si=Av9HKthu8O9wEXGm"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>

                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/-eWpFQ9rDos?si=7QZpyucS4EGulPl7" 
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>

                                <!-- Enkeldans -->
                                <details class="group/sub bg-white rounded-2xl overflow-hidden">
                                    <summary class="cursor-pointer px-2 sm:px-4 py-3 text-lg font-semibold text-violet-700 hover:bg-violet-50 group-open/sub:border-b-violet-500 group-open/sub:border-b-2 transition-colors flex items-center gap-2 rounded-sm">
                                        Enkeldans
                                            <ChevronDown class="h-5 w-5 stroke-[2.5] transition-transform group-open/sub:rotate-180 duration-700 ease-out" />
                                    </summary>
                                    <div class="p-1 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/8PLC-KWs4c0?si=pk7x-OE3AfzP6xfh" 
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>

                                        <div
                                            class="bg-white rounded-xl shadow overflow-hidden"
                                        >
                                            <div class="aspect-video">
                                                <iframe
                                                    class="w-full h-full"
                                                    src="https://www.youtube.com/embed/QWZp2WVukkY?si=LTEtEeruo-R8zkWa"
                                                    title="YouTube video player"
                                                    frameborder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    referrerpolicy="strict-origin-when-cross-origin"
                                                    allowfullscreen
                                                ></iframe>
                                            </div>
                                        </div>
                                    </div>
                                </details>
                            </div>
                        </details>
                    </div>
                </div>
            {/if}

            {#if view === VIEWS.STATISTICS}
                <div class="mt-8 mb-12 mx-auto max-w-4xl">
                    <h2 class="mb-6 text-3xl font-bold text-center text-violet-700">
                        Treningsstatistikk
                    </h2>

                    <!-- Periode-velger -->
                    <div class="mb-6 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
                        <!-- Periode-type velger -->
                        <div class="relative flex bg-slate-200 rounded-full w-full md:w-[300px]" style="padding: 0.175rem;">
                            <div
                                class="absolute bg-violet-600 rounded-full shadow-sm transition-all duration-500"
                                style={`top: 0.175rem; left: 0.175rem; height: calc(100% - 0.35rem); width: calc(33.333% - 0.38rem); transform: translateX(${
                                    statsPeriod === "week" ? "0" :
                                    statsPeriod === "month" ? "calc(100% + 0.35rem)" :
                                    "calc(200% + 0.7rem)"
                                });`}
                            ></div>

                            <button
                                on:click={() => statsPeriod = "week"}
                                class={`relative z-10 w-1/3 text-sm font-medium py-2 px-4 transition-colors ${
                                    statsPeriod === "week" ? "text-white" : "text-slate-700 hover:text-violet-700"
                                }`}
                            >
                                Uke
                            </button>
                            <button
                                on:click={() => statsPeriod = "month"}
                                class={`relative z-10 w-1/3 text-sm font-medium py-2 px-4 transition-colors ${
                                    statsPeriod === "month" ? "text-white" : "text-slate-700 hover:text-violet-700"
                                }`}
                            >
                                Måned
                            </button>
                            <button
                                on:click={() => statsPeriod = "year"}
                                class={`relative z-10 w-1/3 text-sm font-medium py-2 px-4 transition-colors ${
                                    statsPeriod === "year" ? "text-white" : "text-slate-700 hover:text-violet-700"
                                }`}
                            >
                                Sesong
                            </button>
                        </div>

                        <!-- Navigering -->
                        <div class="flex items-center gap-2 justify-center sm:justify-end">
                            <button
                                on:click={() => changePeriod("prev")}
                                class="border border-slate-300 rounded-xl p-2 hover:bg-slate-50 transition-colors"
                                aria-label="Forrige periode"
                            >
                                <ChevronLeft class="h-5 w-5" />
                            </button>
                            
                            <div class="min-w-[200px] text-center">
                                <p class="text-lg font-semibold text-slate-800">
                                    {getPeriodLabel(statsPeriod, statsStartDate)}
                                </p>
                            </div>

                            <button
                                on:click={() => changePeriod("next")}
                                class="border border-slate-300 rounded-xl p-2 hover:bg-slate-50 transition-colors"
                                aria-label="Neste periode"
                            >
                                <ChevronRight class="h-5 w-5" />
                            </button>

                            <!-- LEGG TIL KALENDERKNAPP -->
                            <button
                                on:click={openStatsCalendar}
                                class="border border-violet-300 bg-violet-50 rounded-xl p-2 hover:bg-violet-100 transition-colors"
                                aria-label="Velg dato"
                            >
                                <Calendar class="h-5 w-5 text-violet-600" />
                            </button>
                        </div>
                    </div>

                    <!-- Statistikk-kort -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        <!-- Hardøkter -->
                        <div class="bg-white rounded-2xl border-2 border-red-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-red-100 rounded-xl p-3">
                                    <Timer class="h-6 w-6 text-red-700" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-red-700">{stats.hardOkter}</p>
                                    <p class="text-sm text-slate-600">Hardøkter</p>
                                </div>
                            </div>
                        </div>

                        <!-- Langturer -->
                        <div class="bg-white rounded-2xl border-2 border-cyan-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-cyan-100 rounded-xl p-3">
                                    <Heart class="h-6 w-6 text-cyan-800" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-cyan-800">{stats.langtur}</p>
                                    <p class="text-sm text-slate-600">Langturer</p>
                                </div>
                            </div>
                        </div>

                        <!-- Styrkeøkter -->
                        <div class="bg-white rounded-2xl border-2 border-yellow-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-yellow-100 rounded-xl p-3">
                                    <Dumbbell class="h-6 w-6 text-yellow-800" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-yellow-800">{stats.styrke}</p>
                                    <p class="text-sm text-slate-600">Styrkeøkter</p>
                                </div>
                            </div>
                        </div>

                        <!-- Hviledager -->
                        <div class="bg-white rounded-2xl border-2 border-green-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-green-100 rounded-xl p-3">
                                    <BatteryCharging class="h-6 w-6 text-green-800" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-green-800">{stats.hvile}</p>
                                    <p class="text-sm text-slate-600">Hviledager</p>
                                </div>
                            </div>
                        </div>

                        <!-- Totalt antall økter -->
                        <div class="bg-white rounded-2xl border-2 border-violet-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-violet-100 rounded-xl p-3">
                                    <Calendar class="h-6 w-6 text-violet-700" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-violet-700">{stats.totalEconomic}</p>
                                    <p class="text-sm text-slate-600">Totalt økter</p>
                                </div>
                            </div>
                        </div>

                        <!-- Total treningstid -->
                        <div class="bg-white rounded-2xl border-2 border-violet-200 p-6 shadow-sm">
                            <div class="flex items-center gap-3 mb-2">
                                <div class="bg-violet-100 rounded-xl p-3">
                                    <Clock class="h-6 w-6 text-violet-700" />
                                </div>
                                <div>
                                    <p class="text-3xl font-bold text-violet-700">
                                        {stats.totalHours}t {#if stats.totalMins > 0} {stats.totalMins.toString().padStart(2, '0')}min {/if}
                                    </p>
                                    <p class="text-sm text-slate-600">Timer totalt</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Detaljert liste over økter i perioden -->
                    <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                        <h3 class="text-xl font-bold text-slate-800 mb-4">
                            Økter i perioden
                        </h3>
                        
                        {#if periodWorkouts.length === 0}
                            <p class="text-slate-600 italic">Ingen økter registrert i denne perioden.</p>
                        {:else}
                            <div class="space-y-2 max-h-96 overflow-y-auto">
                                {#each groupByDate(periodWorkouts.sort((a, b) => a.date.localeCompare(b.date))) as g}
                                    <div class="border border-slate-200 rounded-xl p-3">
                                        <p class="text-sm md:text-lg font-semibold text-slate-700 mb-2">
                                            {format(parseISO(g.date), "EEEE d. MMMM", { locale: nb })}
                                        </p>
                                        <div class="space-y-1">
                                            {#each g.sessions as s}
                                                {@const info = getWorkoutInfo(s.title)}
                                                <div class="flex items-center gap-2 text-xs md:text-sm">
                                                    <div class={`px-2 py-1 rounded-lg ${info.color} font-medium flex items-center gap-1`}>
                                                        <svelte:component this={info.icon} class="h-4 w-4" />
                                                        {s.title}
                                                    </div>
                                                    {#if s.durationMin}
                                                    <Clock class="text-slate-500 h-4 w-4" />
                                                    <span class="text-slate-600">
                                                            {formatTime(s.durationMin)}
                                                    </span>
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
                <!-- Kalenderdialog -->
                {#if showStatsCalendar}
                    <div 
                        class="fixed bg-white/80 inset-0 z-50 flex items-center justify-center p-4"
                        on:click={closeStatsCalendar}
                        on:keydown={(e) => e.key === 'Escape' && closeStatsCalendar()}
                        role="button"
                        tabindex="0"
                    >
                        <div 
                            class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
                            on:click|stopPropagation
                            role="dialog"
                            aria-modal="true"
                        >
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-xl font-bold text-slate-800">
                                    Velg {statsPeriod === "week" ? "uke" : statsPeriod === "month" ? "måned" : "sesong"}
                                </h3>
                                <button
                                    on:click={closeStatsCalendar}
                                    class="text-slate-400 hover:text-slate-600 transition-colors"
                                    aria-label="Lukk"
                                >
                                    <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                    </svg>
                                </button>
                            </div>

                            <!-- Kalenderhode -->
                            <div class="flex justify-between items-center mb-4">
                                <button
                                    on:click={() => changeStatsCalendarMonth("prev")}
                                    class="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                    aria-label="Forrige måned"
                                >
                                    <ChevronLeft class="h-5 w-5" />
                                </button>
                                
                                <h4 class="text-lg font-semibold text-slate-800">
                                    {format(statsCalendarCursor, "MMMM yyyy", { locale: nb })}
                                </h4>

                                <button
                                    on:click={() => changeStatsCalendarMonth("next")}
                                    class="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                    aria-label="Neste måned"
                                >
                                    <ChevronRight class="h-5 w-5" />
                                </button>
                            </div>

                            <!-- Ukedager -->
                            <div class="grid grid-cols-7 gap-1 mb-2">
                                {#each ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"] as day}
                                    <div class="text-center text-xs font-semibold text-slate-600 py-2">
                                        {day}
                                    </div>
                                {/each}
                            </div>

                            <!-- Kalenderdager -->
                            <div class="grid grid-cols-7 gap-1">
                                {#each statsCalendarDays as day}
                                    {#if day}
                                        {@const isInSelectedPeriod = (() => {
                                            if (statsPeriod === "week") {
                                                const weekStart = startOfWeek(statsStartDate, { weekStartsOn: 1 });
                                                const weekEnd = endOfWeek(statsStartDate, { weekStartsOn: 1 });
                                                return isWithinInterval(day, { start: weekStart, end: weekEnd });
                                            } else if (statsPeriod === "month") {
                                                return isSameDay(startOfMonth(day), startOfMonth(statsStartDate));
                                            } else {
                                                // Fjernet ": Date" her for å unngå "Unexpected token"
                                                const getSeasonStart = (d) => {
                                                    const year = d.getFullYear();
                                                    // Hvis vi er i jan-apr (0-3), startet sesongen 1. mai året før
                                                    return d.getMonth() < 4 ? new Date(year - 1, 4, 1) : new Date(year, 4, 1);
                                                };

                                                const currentSeasonStart = getSeasonStart(statsStartDate);
                                                const daySeasonStart = getSeasonStart(day);
                                                
                                                return isSameDay(currentSeasonStart, daySeasonStart);
                                            }
                                        })()}
                                        {@const isToday = isSameDay(day, new Date())}
                                        
                                        <button
                                            on:click={() => selectStatsDate(day)}
                                            class={`
                                                aspect-square p-2 rounded-lg text-sm transition-all
                                                ${isInSelectedPeriod 
                                                    ? 'bg-violet-500 text-white font-semibold shadow-sm' 
                                                    : isToday
                                                        ? 'bg-violet-100 text-violet-700 font-semibold'
                                                        : 'hover:bg-slate-100 text-slate-700'
                                                }
                                            `}
                                        >
                                            {format(day, "d")}
                                        </button>
                                    {:else}
                                        <div class="aspect-square"></div>
                                    {/if}
                                {/each}
                            </div>

                            <!-- Hurtigvalg -->
                            <div class="mt-6">
                                <button
                                    on:click={() => {
                                        const now = new Date();
                                        if (statsPeriod === "week") {
                                            statsStartDate = startOfWeek(now, { weekStartsOn: 1 });
                                        } else if (statsPeriod === "month") {
                                            statsStartDate = startOfMonth(now);
                                        } else {
                                            statsStartDate = startOfYear(now);
                                        }
                                        closeStatsCalendar();
                                    }}
                                    class="w-full px-4 py-2 bg-violet-50 text-violet-500 rounded-lg font-medium hover:bg-violet-200 transition-colors"
                                >
                                    {statsPeriod === "week" ? "Nåværende uke" : statsPeriod === "month" ? "Nåværende måned" : "I år"}
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>

        {#if view === VIEWS.CALENDAR}
            <div class="mt-8 mb-12 mx-auto max-w-6xl px-4">
                <div
                    class="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-3 sm:gap-0"
                >
                    <h3 class="text-2xl font-bold text-center sm:text-left">
                        {format(calendarCursor, "LLLL yyyy", { locale: nb })}
                    </h3>

                    <div class="flex justify-center sm:justify-end gap-2">
                        <button
                            on:click={goToToday}
                            class="border rounded-xl px-3 py-2 text-sm hover:bg-violet-50"
                        >
                            I dag
                        </button>
                        <button
                            on:click={() => changeMonth("prev")}
                            class="border rounded-xl p-2"
                        >
                            <ChevronLeft class="h-4 w-4" />
                        </button>
                        <button
                            on:click={() => changeMonth("next")}
                            class="border rounded-xl p-2"
                        >
                            <ChevronRight class="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div
                    class="grid grid-cols-7 gap-2 text-center text-sm text-slate-600"
                >
                    {#each ["man", "tir", "ons", "tor", "fre", "lør", "søn"] as d}
                        <div>{d}</div>
                    {/each}
                </div>

                <div class="mt-2 grid grid-cols-7 gap-2">
                    {#each days as d}
                        {#if d}
                            <button
                                class={`relative rounded-xl border p-2 pt-8 text-left bg-white hover:bg-violet-50 transition-colors ${
                                    isSameDay(d, activeDate)
                                        ? "border-violet-500"
                                        : "border-slate-200"
                                }`}
                                on:click={() => selectDay(d)}
                            >
                                <div
                                    class="absolute top-1 left-1 flex items-start justify-start"
                                >
                                    <div
                                        class="hidden sm:flex w-7 h-7 rounded-full bg-violet-600 text-white text-xs font-semibold items-center justify-center shadow-sm"
                                    >
                                        {format(d, "d")}
                                    </div>

                                    <div
                                        class="text-sm font-medium text-center sm:hidden"
                                    >
                                        {format(d, "d")}
                                    </div>
                                </div>

                                {#await Promise.all(workouts
                                        .filter((w) => w.date === format(d, "yyyy-MM-dd"))
                                        .map( (w) => getWorkoutInfo(w.title), )) then infos}
                                    {#if infos.length > 0}
                                        <div
                                            class="flex sm:hidden mt-1 flex-wrap gap-1"
                                        >
                                            {#each infos.slice(0, 3) as info, idx (idx)}
                                                <div
                                                    class="w-3 h-3 rounded-full shadow-sm"
                                                    style={`background-color: ${
                                                        info.color.includes(
                                                            "bg-red-100",
                                                        )
                                                            ? "#ff0000"
                                                            : info.color.includes(
                                                                    "bg-yellow-100",
                                                                )
                                                              ? "#ffff00"
                                                              : info.color.includes(
                                                                      "bg-green-100",
                                                                  )
                                                                ? "#00ff00"
                                                                : info.color.includes(
                                                                        "bg-cyan-100",
                                                                    )
                                                                  ? "#00ffff"
                                                                  : "#f9eeff"
                                                    };`}
                                                ></div>
                                            {/each}
                                            {#if infos.length > 3}
                                                <div
                                                    class="w-3 h-3 rounded-full bg-slate-400 shadow-sm"
                                                ></div>
                                            {/if}
                                        </div>
                                    {/if}
                                {/await}

                                <div class="hidden sm:block mt-1">
                                    {#each workouts
                                        .filter((w) => w.date === format(d, "yyyy-MM-dd"))
                                        .slice(0, 2) as w}
                                        {#await Promise.resolve(getWorkoutInfo(w.title)) then info}
                                            <div
                                                class={`text-xs ${info.color} px-2 py-0.5 rounded-lg mb-0.5 break-words whitespace-normal font-medium`}
                                            >
                                                {w.title}
                                            </div>
                                        {/await}
                                    {/each}
                                </div>
                            </button>
                        {:else}
                            <div></div>
                        {/if}
                    {/each}
                </div>
            </div>
        {/if}
    </div>
{/if}
