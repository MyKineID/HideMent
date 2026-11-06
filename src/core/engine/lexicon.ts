import type { Term } from "./matcher";

/*
 * Kamus berbobot untuk mesin keputusan lokal. Bobot = kontribusi log-odds (≈ seberapa kuat istilah itu
 * menggeser keyakinan). Bias awal tiap kategori -4 (≈2%), jadi:
 *   bobot ±2  → bukti sedang (perlu bukti lain / target orang),
 *   bobot ±3,5 → bukti kuat (hampir pasti kalau ditambah satu petunjuk lagi).
 * Istilah ditulis huruf kecil; leetspeak, huruf hias, dan huruf berulang sudah dirapikan sebelum dicocokkan.
 * "kata*" = awalan, "dua kata" = frasa.
 */

const t = (w: number, ...words: string[]): Term[] => words.map((x) => ({ t: x, w }));

/* ── target: komentar ditujukan ke orang ─────────────────────────────── */

/** Kata ganti orang kedua / sapaan langsung. */
export const TARGET_YOU: Term[] = t(1, "lu", "lo", "loe", "lw", "elu", "elo", "kamu", "km", "kau", "dikau", "engkau", "ente", "anda", "situ", "kalian", "kalean", "u", "you", "sampeyan", "kowe", "maneh");

/** Orang ketiga / orang tertentu yang sedang dibicarakan. */
export const TARGET_THEM: Term[] = [
  ...t(0.8, "dia", "doi", "orang ini", "ini orang", "nih orang", "orang itu", "tuh orang", "nih bocah", "bocah ini", "cewek ini", "cowok ini", "nih cewek", "nih cowok", "si", "bapak ini", "ibu ini", "emak ini", "anak ini", "akun dia", "akun ini"),
  ...t(0.6, "bocil", "bocah"),
  ...t(0.8, "jadi orang", "sebagai manusia", "jadi manusia"),
];

/** Bagian tubuh/diri seseorang: hinaan ke sini hampir selalu menyerang pribadi. */
export const BODY: Term[] = t(1, "muka", "mukamu", "wajah", "badan", "body", "tubuh", "otak", "otakmu", "mulut", "suara", "kepala", "idung", "hidung", "jidat", "kulit", "rambut", "gigi", "perut", "kelakuan", "tampang", "jidatmu", "mukanya", "iq", "iqnya", "iq lu", "iq lo", "wajahnya", "badannya", "suaranya", "otaknya", "mulutnya", "kelakuannya", "tampangnya");

/** Sapaan "dasar X" = makian yang ditujukan langsung. */
export const VOCATIVE: Term[] = t(1, "dasar");

/** Menyebut diri sendiri ("aku goblok banget"): kata kasar ke diri sendiri bukan hinaan. */
export const SELF: Term[] = t(1, "aku", "gw", "gue", "gua", "saya", "ane", "aing", "diriku", "akuu");

/** Sapaan ramah ke kreator (kak, bang): menandai komentar ditujukan ke orang, tapi lemah. */
export const ADDRESS: Term[] = t(0.5, "kak", "ka", "bang", "bro", "sis", "gan", "min", "mas", "mbak", "mba", "om", "tante", "bund", "say", "beb");

/** Kritik pada karya/konten, bukan orangnya: kata kasar di sini biasanya kritik wajar. */
export const CONTENT: Term[] = t(
  1,
  "video", "videonya", "konten", "kontennya", "editing", "editingnya", "editan", "audio", "audionya", "thumbnail", "judul", "judulnya",
  "argumen", "argumennya", "data", "datanya", "penjelasan", "penjelasannya", "film", "filmnya", "lagu", "lagunya", "produk", "produknya",
  "pelayanan", "pelayanannya", "kebijakan", "pemerintah", "harga", "harganya", "kualitas", "kualitasnya", "game", "gamenya", "aplikasi",
  "aplikasinya", "episode", "episodenya", "alur", "alurnya", "cerita", "ceritanya", "intro", "sumber", "menit", "tips", "opini", "artikel",
  "thread", "postingan", "desain", "desainnya", "gambar", "gambarnya", "tulisan", "tulisannya", "review", "materi", "materinya", "isi",
  "isinya", "endorse", "iklan", "iklannya", "layanan", "sistem", "server", "update", "fitur", "rasa", "rasanya", "transisi", "transisinya",
  "musik", "musiknya", "mic", "kamera", "kameranya", "dubbing", "subtitle", "teks", "caption", "logika", "logikanya", "analisis",
  /* benda & makanan: "kopinya item banget kayak aspal" bukan menghina orang */
  "kopi", "kopinya", "teh", "tehnya", "nasi", "nasinya", "kue", "kuenya", "roti", "rotinya", "masakan", "masakannya", "sambelnya", "mobil", "mobilnya", "motor", "motornya", "cat", "catnya", "warnanya", "langit", "langitnya", "jalan", "jalannya", "hp", "hpnya", "laptop", "laptopnya", "baju", "bajunya", "sepatu", "sepatunya", "tas", "tasnya", "rumah", "rumahnya", "kamar", "kamarnya", "kucingnya", "anjingnya", "ikannya", "ayamnya", "kambingnya",
);

/** Ekspresi kaget/kagum yang terdengar kasar tapi bukan hinaan. */
export const EXPRESSION: Term[] = t(1, "anjir", "anjay", "anjrit", "njir", "njay", "anjim", "anjas", "buset", "busyet", "gokil", "wkwk", "wkwkwk", "awokwok", "astaga", "asw", "jir", "cuy", "anjer");

/** Kata pujian. Netral sendirian; dipakai untuk sarkasme dan untuk meredam kata "gila/parah" yang memuji. */
export const PRAISE: Term[] = t(
  1,
  "bagus", "keren", "mantap", "mantab", "mantep", "hebat", "pinter", "pintar", "cantik", "ganteng", "cakep", "lucu", "gemes", "gemesin",
  "menginspirasi", "informatif", "bermanfaat", "top", "mantul", "sukses", "selamat", "kece", "jago", "berbakat", "luar biasa", "wow",
  "indah", "imut", "cakap", "sempurna", "idola", "terbaik", "best", "bangga", "suka", "seru", "enak", "manis", "rapi", "makasih", "terima kasih", "merdu", "dewasa", "jujur", "salut", "masyaallah", "masya allah", "subhanallah", "amazing", "nice", "cool", "berprestasi", "panutan", "sultan",
);

/* ── Ujaran kebencian ────────────────────────────────────────────────── */

/** Makian kuat. Tetap kuat walau target tidak disebut. */
export const INSULT_STRONG: Term[] = [
  /* Tuduhan/makian khas thread "bongkar akun" & gosip: pedo, predator, bejat, psikopat. */
  ...t(2.8, "pedo", "pedofil", "predator", "predator anak", "groomer", "bejat", "psikopat", "psycho", "sakit jiwa", "gangguan jiwa", "hidung belang", "buaya darat", "fakboy", "fuckboy", "penjahat kelamin", "om om mesum", "manusia sampah", "gak ada akhlak", "ga ada akhlak", "tidak berakhlak", "kriminal"),
  ...t(1.6, "creepy", "red flag", "toxic", "penjarain", "penjarakan", "masukin penjara", "pantes dipenjara", "ilfeel", "ilfil"),
  /* Dehumanisasi: memperlakukan orang seperti hewan/makhluk lain. */
  ...t(3.4, "sekandang berapa", "satu kandang", "lepas dari kebun binatang", "kebun binatang mana", "manusia apa bukan", "manusia bukan sih", "evolusi gagal", "evolusi lu gagal", "setengah monyet", "nenek moyang lu", "keturunan monyet", "turunan monyet", "muka minta ditabok", "muka minta ditampol", "muka minta digampar", "muka kriminal", "tampang maling", "muka maling", "muka babu", "muka tembok", "aib keluarga", "anak pungut", "anak haram", "misqueen", "tua bangka", "bau tanah", "janda gatel", "pelakor", "pebinor", "cabe cabean", "bau kencur", "bocah ingusan", "isinya upil", "kurang gizi", "kayak orang mabok", "gak ada harganya"),
  ...t(3.0, "sekandang"),
  ...t(2.6, "makhluk apa", "makhluk apaan", "spesies apa"),
  ...t(3.2, "goblok", "goblog", "gblk", "tolol", "tlol", "bego", "begok", "idiot", "dungu", "bangsat", "bgst", "bajingan", "keparat", "brengsek", "kontol", "kntl", "memek", "ngentot", "bloon", "blo on", "oon", "dongo", "pekok", "geblek", "stupid", "dumb", "moron", "retard", "idiot af", "ugly", "ugly af", "loser", "bitch", "fuck you", "fck", "fak lu", "trash", "pathetic"),
  ...t(2.6, "bodoh", "sinting", "sarap", "otak udang", "otak kosong", "otaknya kosong", "otakmu kosong", "otak cetek", "otaknya cetek", "otak geser", "otaknya geser", "otak miring", "otaknya miring", "otak error", "gak ada otaknya", "gak ada otak", "tidak punya otak", "gak punya otak", "ga punya otak", "nggak punya otak", "tak berotak", "otak di dengkul", "di dengkul", "pelacur", "lonte", "sampah masyarakat", "bacot", "bacod", "bct", "banci", "bencong", "pecundang", "tai", "tahi", "taik", "najis", "bedebah", "biadab", "laknat"),
  ...t(1.6, "anjing", "anjg", "ajg", "babi", "monyet", "kunyuk", "setan", "iblis", "kampungan", "jamet", "sampah", "sialan", "budek", "gila lu", "gila lo", "stres lu", "stres lo", "jancok", "jancuk", "cok", "asu", "kampret"),
];

/** Hinaan ringan / body shaming. Butuh target orang supaya dihitung penuh. */
export const INSULT_MILD: Term[] = [
  ...t(2.0, "gendut", "gembrot", "gembul", "ndut", "dekil", "buluk", "burik", "pesek", "kerempeng", "cungkring", "cebol", "jerawatan", "ompong", "muka pas pasan", "pas pasan", "buruk rupa", "jelek banget mukanya", "ngaca", "ngaca dulu", "bikin mual", "bikin muntah", "jijik", "menjijikkan", "menjijikan", "gak pantes", "ga pantes", "gak pantas", "nggak pantes", "gak tau diri", "ga tau diri", "tau diri", "gak guna", "ga guna", "gak berguna", "tidak berguna", "beban", "parasit", "benalu", "nyusahin", "menyusahkan", "cacat", "autis", "cupu", "culun", "norak", "alay", "lebay", "caper", "belagu", "songong", "sombong", "oneng", "lemot", "sakit kuping", "bikin sakit kuping", "sakit telinga", "bikin sakit mata", "merusak mata", "polusi", "satu digit", "iq jongkok", "iq rendah", "iq kecil", "iq nol", "iq sendal", "otak sendal", "miskin aja belagu", "miskin", "kere", "udik", "katrok", "ndeso", "kemayu", "dower", "bibir dower", "pager rusak", "kayak tengkorak", "item banget", "item legam", "hitam legam", "item amat", "kusam", "murahan", "sejelek ini", "pede masuk tv"),
  ...t(1.2, "nyebelin", "menyebalkan", "jelek", "bau", "botak", "aneh", "freak", "stres", "gila", "payah", "lemah", "males", "pemalas", "sok", "sok jago", "sok asik", "sok cantik", "sok ganteng", "kepedean", "mending diem", "diem aja", "diem lu", "berisik", "bisu", "tuli", "buta", "cengeng", "penakut", "pengecut", "penjilat", "munafik", "pembohong", "penipu", "maling", "pencuri", "licik"),
];

/** "kayak kecoak", "mirip monyet": perbandingan merendahkan. */
export const COMPARE_RE =
  /\b(?:kayak|kaya|kek|kyk|kayaknya|mirip|bagai|bak|macam|kayak)\s+(?:\p{L}+\s+)?(?:kecoak|kecoa|kambing|monyet|babi|anjing|sapi|kuda|tikus|cacing|kodok|setan|badut|sampah|orang gila|banci|bencong|gorila|beruk|lutung|kerbau|keledai|ular|lintah|tai|tahi|gembel|pengemis|mayat|zombie|alien|tuyul|genderuwo|kuntilanak|ondel ondel|kingkong|buaya|biawak|kutu|lalat|belatung|aspal|arang|oli|kecap|keset|selai coklat|selai cokelat|gentong|karung beras|tengkorak|orang utan|pantat wajan|wajan|panci|lele|ikan lele|pager rusak|colokan|tembok|tembok semen|kerupuk|upil|kuda nil|orang mabok|babu|kuli|ikan bakar|kopi tubruk)\b/u;

/** Menghina warna kulit dengan membandingkannya ke benda/makanan gelap ("kulitnya kayak aspal", "orang apa kecap? item amat"). */
export const SKIN_RE =
  /(?:\b(?:kulit\p{L}*|item|hitam|gelap|dekil|gosong|legam)\b.{0,30}\b(?:kayak|kaya|kek|kyk|mirip|apa)\s+(?:\p{L}+\s+)?(?:aspal|arang|oli|kecap|kopi|selai|coklat|cokelat|batu bara|wajan|panci|ban|knalpot|jelaga|ikan bakar|tuyul)\b)|(?:\b(?:kayak|kaya|kek|kyk|apa)\s+(?:aspal|arang|oli|kecap|selai coklat|selai cokelat|batu bara)\b.{0,30}\b(?:item|hitam|gelap|legam|amat|dekil|gosong)\b)/u;

export const BULLY: Term[] = [
  ...t(4.2, "mending lu mati", "mending lo mati", "mending kamu mati", "lu mati aja", "lo mati aja", "kamu mati aja", "mati aja lu", "mati aja lo", "bunuh diri aja", "bundir aja", "gantung diri", "gantung diri aja", "loncat aja dari"),
  ...t(3.2, "mati aja", "mampus aja", "modar aja", "mati sana", "biar mampus", "pantes ditinggal", "pantesan ditinggal", "kasian deh lo", "kasian deh lu", "kasihan deh lo", "gak ada yang mau", "ga ada yang mau", "nggak ada yang mau", "kita bully", "bully rame", "bully ramai", "hujat rame", "hujat ramai", "kita hujat", "gas hujat", "serbu akunnya", "serbu akun", "spam komen", "spam komentar", "report akun", "report rame", "report ramai", "laporin rame", "biar kena mental", "hapus aja akunnya", "unfollow rame", "boikot dia", "biar tau rasa", "pantes di bully", "pantes dibully", "pantas dibully", "layak di bully", "layak dibully", "pantes dihujat", "pantes dirundung", "gak punya temen", "ga punya temen", "gak punya teman", "nggak punya temen", "gak bakal ada yang mau", "sebarin aibnya", "sebar aibnya", "biar malu", "permalukan", "unalive", "unalive aja", "kys", "kill yourself", "go die", "kita hajar rame", "hajar rame", "kita hajar", "gak ada yang mau temenan", "gak ada yang mau duduk", "terima aja nasib", "biar semua tau", "sebar ke grup", "sebarin ke grup", "biar diketawain", "diketawain bareng", "bikin dia trending", "biar malu seumur hidup", "malu seumur hidup", "gak usah ditemenin", "biar kapok", "tau aib lu", "pindah planet", "ilang aja dari", "pantes dikatain", "ramein kolom komentarnya", "kasih paham dia", "kirim stiker monyet"),
  ...t(2.2, "gak heran", "kena mental", "sebarin", "biar viral", "tag temen", "tag temen temen", "ngompol", "dulu ngompol", "hapus akun", "tau rasa", "rasain", "rame rame", "ramai ramai", "rame2", "bully", "bullying", "hujat", "serbu", "kemarin viral", "yang viral itu", "di semua videonya", "sekolah dulu sana", "bocil gak guna", "bocil ga guna", "gak ada gunanya", "aib", "malu maluin", "malu maluin aja", "gak laku", "ga laku", "perawan tua", "jomblo seumur hidup", "dikucilkan", "jauhin aja", "jauhin dia"),
];

export const THREAT: Term[] = [
  ...t(4.0, "gw bunuh", "gue bunuh", "gua bunuh", "aku bunuh", "bunuh lu", "bunuh lo", "bunuh kamu", "gw bacok", "gue bacok", "bacok lu", "gw tusuk", "gue tusuk", "gw tembak", "gw culik", "gue culik", "gw habisi", "gue habisi", "habisi lu", "gw abisin", "gue abisin", "gw hajar", "gue hajar", "hajar lu", "gebukin lu", "gw gebukin", "gw cari lu", "gue cari lu", "gw cari lo", "aku cari kamu", "tau rumah lu", "tau rumah lo", "tau rumahmu", "tahu rumahmu", "tahu rumah lu", "sebar data", "sebarin data", "gw sebar", "gue sebar", "doxing", "dox"),
  ...t(3.0, "cari lu", "cari lo", "cari kamu sampai", "datengin rumahnya", "datangi rumahmu"),
  ...t(2.6, "gw pastiin lo", "gue pastiin lo", "gw pastiin lu", "pastiin lo gak", "gak bisa jalan", "ga bisa jalan", "gak bisa jalan lagi", "gw tandain", "gue tandain", "tandain muka", "tau lu kerja", "tau lo kerja", "tau kantor", "tau sekolah", "tau kos", "tau kosan", "tunggu di parkiran", "tunggu di depan", "lacak ip", "udah lacak", "gw lacak", "gue lacak", "tau ip", "jangan kaget kalau", "tinggal rangka", "tinggal abu", "gak bakal aman", "ga bakal aman", "gak akan aman", "tau rumah", "tahu rumah", "awas lu", "awas lo", "awas kamu", "awas aja", "tunggu pembalasan", "tunggu aja", "liat aja nanti", "lihat aja nanti", "siap siap aja", "sampe dapet", "sampai dapat", "sampe dapat", "sampai dapet", "gak pulang", "ga pulang", "nggak pulang", "tinggal nama", "pulang tinggal nama", "datengin", "datangin", "datangi rumahnya", "samperin", "patahin", "remukin", "babak belur", "bakar rumah", "keluarga lu", "keluarga lo", "keluargamu", "anak lu", "anak lo", "nomor hp dia", "nomor hpnya", "no hp dia", "alamat rumahnya", "ini alamat", "alamatnya"),
  ...t(2.0, "gw cari", "gue cari", "gua cari"),
  ...t(1.4, "berani ngomong", "di balik layar", "jangan kaget", "motor lu", "mobil lu", "rumah lu", "motor lo", "rumah lo", "gw pastiin", "gue pastiin", "foto ktp", "ktp dia", "alamat", "nomor hp", "no hp", "nanti malam", "besok malam", "hati hati di jalan", "hati hati aja", "sekali lagi lu", "sekali lagi lo", "sekali lagi kamu", "gebuk", "hajar", "bacok", "tusuk", "bunuh", "habisi", "abisin", "culik", "teror", "jl"),
];

/** Penanda sarkasme / ejekan terselubung. */
export const MOCK: Term[] = [
  ...t(2.2, "keajaiban dunia", "keajaiban", "ada juga yang mau", "akhirnya ada yang mau", "paling suci", "manusia paling", "paling bener", "paling benar", "paling pinter", "paling hebat", "paling pintar", "cara jadi beban", "jadi beban", "beban keluarga", "beban negara", "saking pinternya", "saking", "nyogok", "lulus sd", "sd aja", "tamat sd", "filternya", "pake filter", "editan photoshop", "iya deh", "iya in aja", "iyain aja", "iyain", "terserah lu deh", "terserah kamu deh", "bikin anjing", "ikut nangis", "telinga berdarah", "kuping berdarah", "bikin sakit mata", "mata gw sakit", "kalau dilihat dari jauh", "kalo dilihat dari jauh", "pake sedotan", "level dewa"),
  ...t(1.2, "selamat ya", "hebat banget ya", "pinter banget", "pintar banget", "hebat ya", "wah hebat", "luar biasa sekali", "bangga banget", "kok bisa ya"),
];

/**
 * Kata kegagalan/keburukan. Dipasangkan dengan pujian ("keren ya, nyanyi fals aja pede") menjadi
 * pujian palsu: tanda sarkasme yang kuat.
 */
export const MOCK_NEG: Term[] = t(
  1,
  "fals", "sumbang", "remed", "remedial", "gagal", "nyontek", "ketiduran", "ilfeel", "ilfil", "nyebelin", "menyebalkan", "garing",
  "cringe", "krik", "malu maluin", "bikin malu", "ngelindur", "ngawur", "salah jawab", "salah mulu", "gak lulus", "ga lulus", "dimatiin",
  "nyesel", "tertawaan", "bahan tertawaan", "bahan ketawaan", "kabur semua", "pada kabur", "ngantuk", "bosen", "gak jelas", "ga jelas",
  "pede banget", "kepedean", "jelek", "kalah", "nol besar", "nyogok", "paling nyebelin", "paling jelek", "paling bodoh", "paling bego", "kabur", "ikut kabur", "ngambek", "rebahan", "ketauan", "gak ada bakat", "tanpa bakat", "nganggur", "bokek", "dari jarak", "jarak jauh", "remed", "drama", "baperan", "mewek", "pencitraan",
);

/** "cakep kok, kalau lampunya dimatiin": pujian yang langsung dibatalkan syarat. */
export const CONDITIONAL_PRAISE_RE = / (?:kalau|asal|asalkan) \p{L}+/u;

/** Pembalik setelah pujian ("padahal", "sampe", "cuma"): menguatkan pujian palsu kalau ada kata kegagalan. */
export const CONTRAST_RE = / (?:padahal|cuma|doang|sampe|sampai|saking|akhirnya|jujurnya|tapi) /u;

/** Emoji ejekan; 😂 sendirian sering cuma tertawa, jadi lemah. */
export const MOCK_EMOJI: [RegExp, number][] = [
  [/🙄|🤡|🗿|🥱|💅/u, 1.4],
  [/👏.*👏/u, 1.4],
  [/😂|🤣|😹/u, 0.8],
];

/* ── Pelecehan seksual ───────────────────────────────────────────────── */

export const SEXUAL: Term[] = [
  /* Terselubung tapi jelas di kolom komentar Indonesia: tarif, "ange", "bahan", "tisu mana". */
  ...t(4.0, "sejam berapa", "berapa sejam", "semalam berapa", "ready bo", "bisa booking", "bisa dibooking", "ayam kampus", "bahan coli", "si joni", "auto ange", "auto sange", "jadi ange", "ah ange", "ange banget", "ngangkang", "tinggal ngangkang", "pengen remes", "desahannya", "dicicipin", "digituin", "foto pribadinya", "minta foto pribadi", "scbd", "sebut cantik bonus dm", "angle bawah", "nungging dong", "tisu mana tisu"),
  ...t(3.0, "balik ke wc", "ke wc lagi", "bolak balik wc", "udah keluar ah", "keluar ah", "bahan nanti malam", "bahan malam ini", "auto tegang", "bikin tegang", "adek gw bangun", "adik gw bangun", "adek gw langsung bangun", "adek gw berdiri", "berdiri tegak", "remes", "toge", "tete", "tetenya", "sabun langsung abis", "sabun di rumah langsung abis", "panas dingin", "bikin panas dingin", "pap ketek", "per jam berapa"),
  ...t(2.0, "wlw", "ange", "link full", "full videonya", "full nya", "salfok", "jadi basah", "basah kak"),
  ...t(1.4, "yang lagi viral", "spill link", "zoom in", "slow mo", "ke kamar mandi", "wc"),
  ...t(4.0, "berapa semalam", "short time", "open bo", "open booking", "booking out", "ngentot", "entot", "dientot", "ngewe", "ewe yuk", "ngewe yuk", "ml yuk", "tidur bareng", "bobo bareng", "bawa ke kamar", "ke kamar aja", "cocok buat begituan", "buat begituan", "perkosa", "diperkosa", "perkosain", "rudapaksa", "pemerkosaan", "foto bugil", "video bugil", "vcs", "vcs yuk", "colmek", "coli", "ngocok", "crot", "sange", "sangean", "horny", "ngaceng", "pengen nyicip", "pengen nyobain", "nyicipin", "pengen gw", "pengen gue", "minta dilecehin", "minta dilecehkan", "pantes dilecehin", "pantas dilecehkan", "minta diperkosa", "lecehin", "dilecehin", "pengen pegang", "mau pegang", "pegang pegang", "pengen remas", "pengen grepe", "grepe", "grepein", "pengen elus", "pengen cium", "pengen gigit", "pengen jilat", "jilatin", "ke hotel", "diajak ke hotel", "ajak ke hotel", "check in", "chek in", "cekin", "enaknya diajak", "enaknya dipake", "cuma buat dipake", "bukan dinikahin", "pikiran kemana", "bikin pikiran", "pikiran kotor", "otak ngeres", "ngeres", "biar keliatan", "keliatan dalemnya", "turunin dikit"),
  ...t(3.0, "toket", "tetek", "pentil", "memek", "pepek", "kontol", "titit", "susunya", "dadanya", "pahanya", "pantatnya", "bokongnya", "belahan", "belahannya", "bugil", "telanjang", "porno", "bokep", "mesum", "cabul", "begituan", "lebih terbuka", "baju terbuka", "buka baju", "buka bajunya", "tanpa baju", "montok", "semok", "bohay", "bahenol", "seksi banget", "sexy banget", "bodynya", "body nya", "pap dong", "pap bugil", "pap tt", "jablay", "perek", "lonte", "pelacur", "dibayar berapa", "goyangin", "goyangan", "desah"),
  ...t(1.6, "bisa bayar", "aku bayar", "gw bayar", "gue bayar"),
  ...t(1.4, "pap", "kirim foto", "bajunya ketat", "baju ketat", "angle", "kirim video", "video full", "foto pribadi", "rok pendek", "foto yang lain", "foto lain", "tarif", "seksi", "sexy", "hot", "mulus", "body", "paha", "pantat", "bokong", "dada", "susu", "nenen", "joget", "goyang", "di dm", "dm aku", "dm dong", "wa aku", "pacar aku", "jadi pacar", "nikah yuk", "jadi simpanan", "simpanan", "sugar daddy", "om om", "enak nih", "pasti enak", "mantep", "mantap"),
];

export const SEX_EMOJI_RE = /🤤|😏|🍆|💦|👅|🍑|🥵|😋|😘🔥/u;

/* ── Penistaan agama ─────────────────────────────────────────────────── */

export const RELIGION: Term[] = t(
  1,
  "agama", "agamamu", "islam", "kristen", "katolik", "protestan", "hindu", "buddha", "budha", "konghucu", "nabi", "rasul", "muhammad", "rumah ibadah", "tempat ibadah", "simbol agama",
  "yesus", "isa", "tuhan", "allah", "alquran", "quran", "al quran", "kuran", "injil", "alkitab", "bible", "weda", "tripitaka", "masjid",
  "mesjid", "gereja", "vihara", "klenteng", "salat", "sholat", "solat", "shalat", "ibadah", "ibadahnya", "puasa", "haji", "umroh",
  "jilbab", "hijab", "kerudung", "salib", "kabah", "natal", "lebaran", "ustadz", "ustad", "pendeta", "pastor", "romo", "biksu", "kyai",
  "kiai", "ulama", "syariat", "kitab suci", "kitab", "ajaran", "ajarannya", "ayat", "firman", "dewa", "sesembahan", "sembahyang", "doa",
  "zakat", "sunnah", "hadits", "hadis", "rosul", "tuhanmu", "tuhannya", "nabimu", "nabinya", "kitabnya", "kitabmu", "imannya",
);

export const RELIGION_INSULT: Term[] = [
  ...t(3.4, "dongeng", "khayalan", "omong kosong", "karangan", "fiksi", "takhayul", "palsu", "tipuan", "pedofil", "cabul", "menjijikkan", "menjijikan", "sampah", "tai", "taik", "goblok", "tolol", "bego", "setan", "iblis", "kencingi", "ludahi", "injak injak", "bakar aja", "robek aja", "lelucon", "badut", "sinting", "halu", "ngarang", "bohong", "pembohong", "penipu", "dusta", "sesat", "menyesatkan", "orang gila", "kayak orang gila", "buku cerita", "nakutin anak", "tukang cerita", "haus kekuasaan", "haus darah", "dijadiin kandang", "injek injek", "bungkus gorengan", "cocoknya buat", "buat lap", "tisu toilet", "alas kaki", "kayak senam", "senam massal"),
  ...t(2.0, "babi", "anjing", "najis", "pembunuh", "penjahat", "injek", "ratakan"),
  ...t(1.4, "kandang", "lebih berguna", "dirobohkan", "dihancurkan", "dibakar", "senam"),
  ...t(1.6, "gak jelas", "ga jelas", "primitif", "terbelakang", "kuno", "bodoh", "ngaco", "konyol", "mitos", "injak", "bakar", "robek", "gak masuk akal", "ga masuk akal", "tidak masuk akal", "racun", "candu", "kolot", "hina"),
];

/* ── SARA ─────────────────────────────────────────────────────────────── */

/** Kelompok berdasarkan suku, ras, etnis, agama (penganutnya), golongan, gender, disabilitas. */
export const GROUP: Term[] = [
  ...t(1, "orang item", "orang hitam", "orang timur", "gerombolan", "bencong bencong"),
  ...t(1, "cina", "china", "cokin", "aseng", "tionghoa", "chindo", "pribumi", "jawa", "sunda", "batak", "padang", "minang", "bugis", "madura", "ambon", "papua", "flores", "timor", "dayak", "betawi", "arab", "india", "keling", "negro", "nigga", "bule", "kafir", "kadrun", "cebong", "onta", "kaum", "golongan", "suku", "ras", "etnis", "umat", "pengikutnya", "penganutnya", "pengikut", "penganut", "kelompok", "pendatang", "imigran", "yahudi", "zionis", "syiah", "wahabi", "ahmadiyah", "keturunan", "agama x", "suku x", "ras x", "etnis x", "kelompok x"),
  ...t(1, "orang kristen", "orang islam", "orang hindu", "orang buddha", "orang katolik", "orang cina", "orang china", "orang jawa", "orang batak", "orang padang", "orang papua", "orang madura", "orang arab", "orang india", "orang sunda", "orang ambon"),
  ...t(1, "kulit hitam", "kulit putih", "kulit gelap", "mata sipit", "sipit", "orang timur", "orang barat", "orang kampung", "orang cacat", "difabel", "disabilitas", "tunanetra", "tunarungu", "lgbt", "gay", "homo", "maho", "lesbi", "lesbian", "waria"),
  /* Gender: stereotip ringan ("cowok emang males") tidak boleh langsung setinggi hasutan etnis. */
  ...t(0.6, "cewek", "cewe", "perempuan", "wanita", "cowok", "laki laki", "pria", "janda", "emak emak"),
];

export const GROUP_NEG: Term[] = [
  ...t(3.4, "harus diusir", "pantas diusir", "pantes diusir", "usir aja", "usir dari", "diusir dari", "basmi", "bantai", "musnahkan", "binasakan", "bunuh aja", "sampah masyarakat", "gak usah dikasih ruang", "ga usah dikasih ruang", "jangan dikasih ruang", "dikasih ruang", "pulang ke negaranya", "balik ke negaranya", "balik ke negara asal", "dari sananya", "emang dari sananya", "gak usah sekolah tinggi", "ga usah sekolah tinggi", "ujung ujungnya di dapur", "di dapur aja", "tempatnya di dapur", "kasur dapur sumur", "gak usah jadi pemimpin", "ga usah jadi pemimpin", "penyakit masyarakat", "bawa sial", "perusak bangsa", "hama", "kecoak", "harus dibasmi", "harus dimusnahkan", "dilarang hidup", "beban negara", "cuma jadi beban", "beban masyarakat", "bawaan gen", "udah bawaan", "darahnya", "mata duitan", "gak bisa dipercaya", "jangan belanja", "jangan beli di", "jangan temenan", "jangan nikah sama", "jangan dikasih kerja", "jangan kasih kerja", "jangan pilih", "jangan dipilih", "jangan percaya sama"),
  ...t(2.4, "licik", "pelit", "maling", "penipu", "sampah", "babi", "anjing", "monyet", "biadab", "barbar", "teroris", "penjajah", "kafir", "sesat", "rendahan", "kampungan", "primitif", "terbelakang", "nyusahin", "menyusahkan", "gak guna", "ga guna", "gak berguna", "parasit", "benalu", "perusak", "merusak", "bodoh", "goblok", "tolol", "bego", "gak pantes", "ga pantes", "diusir", "usir"),
  ...t(1.6, "haram", "pemalas", "malas", "males", "kotor", "jorok", "bau", "beban", "menular", "penyakit", "hina", "benci", "ribet", "lebay", "gak ada satupun", "genetik", "dari lahir", "aneh aneh", "boikot", "mabok", "bikin ribut", "rusuh", "bikin onar", "susah diatur", "mata sipit", "dirukiyah", "balik ke hutan", "dipulangin", "bikin celaka", "gak bisa diajak maju", "munafik", "serakah", "kumuh", "gak ada otak"),
];

/** Kata generalisasi: "semua", "emang", "pasti" membuat stereotip menyasar seluruh kelompok. */
export const GENERALIZER: Term[] = t(1, "semua", "semuanya", "emang", "memang", "pasti", "selalu", "mereka", "orang orang", "rata rata", "kebanyakan", "tipikal", "dasar orang", "kaum", "kalian semua", "itu semua");

/* ── Judol/penipuan/spam (pelengkap aturan judol yang sudah ada) ────── */

/** Petunjuk judol halus yang tidak tertangkap daftar istilah judol: testimoni, ajakan ke bio. */
export const JUDOL_SOFT: Term[] = [
  ...t(2.8, "mampir ke bio", "cek bio", "ke bio aku", "link di bio", "saldo nambah", "saldo bertambah", "saldo jadi", "bikin saldo", "nemu situs", "main dimana", "main di mana", "jajan tiap hari", "utang lunas", "lunas utang", "hutang lunas", "transfer ke ortu", "kakek zeus", "kakek merah", "pola gacor", "jam gacor", "situs di bio", "situs bio", "cek profil", "klik profil", "lihat profil", "di gugel", "saldo jadi nambah", "nambah saldo"),
  ...t(1.4, "main di", "duduk manis", "kerja serabutan", "bayar kontrakan", "bayar cicilan", "bayar utang", "tiap bulan", "situs ini", "cari aja", "penghasilan tambahan", "rezeki gak kemana", "rezeki ga kemana", "rahasia", "tiap hari", "berkat", "beli motor", "masih nganggur", "dari hp", "modal hp", "iseng", "cuan", "rezeki", "alhamdulillah"),
];

export const SCAM: Term[] = [
  ...t(3.6, "tanpa bi checking", "bi checking", "tanpa jaminan", "pinjaman cair", "cair 5 menit", "cair dalam", "profit harian", "untung harian", "profit pasti", "untung pasti", "arisan online", "wajib deposit", "wajib transfer", "transfer dulu", "transfer ke admin", "bayar admin", "biaya admin", "bayar pendaftaran", "biaya pendaftaran", "pesugihan", "tanpa tumbal", "kaya mendadak", "pelet", "penglaris", "uang balik", "balikin uang", "bantu balikin", "bisa balikin", "hubungi wa", "hubungi beliau", "wa beliau", "chat admin", "hubungi admin", "dm admin", "wa admin", "akun premium", "kerja dari rumah", "like video dapet", "like video dapat", "gaji harian", "pinjol", "dana cepat", "butuh dana", "ditipu juga", "gandakan uang", "cukup deposit", "deposit dulu", "modal 2jt jadi", "dibimbing mentor", "dibimbing", "gabung bisnis", "bisnis kami", "rekrut 2 orang", "rekrut", "downline", "passive income", "join tim kami"),
  ...t(1.6, "seumur hidup", "pinjaman", "investasi", "crypto", "kripto", "trading", "profit", "untung", "cair", "dijamin", "terbukti", "manjur", "dukun", "mbah", "penghasilan", "gaji", "per hari", "perhari", "jual akun", "dicari", "lowongan", "kerja online", "dm aja", "slot tinggal", "terbatas", "cukup ktp", "mentor", "awalnya gak percaya", "nganggur", "bisnis"),
];

/** Menyebut uang/transfer saja belum penipuan ("salah transfer ke rekening sendiri"); baru dihitung penuh kalau ada iming-iming di atas. */
export const SCAM_MONEY: Term[] = [
  ...t(2.0, "transfer ke rekening", "kirim ke rekening", "transfer ke nomor", "syarat bayar"),
  ...t(1.2, "transfer", "rekening", "bayar", "dp dulu", "dp"),
];

export const SPAM: Term[] = [
  ...t(4.0, "follow back", "folback", "follback", "fb ya", "sub4sub", "subasub", "sub 4 sub", "subs balik", "subscribe balik", "saling follow", "saling subscribe", "mampir ke akun", "mampir ke channel", "mampir ke akunku", "pertamax", "harga grosir", "cek ig kami", "cek ig", "cek akun aku", "cek akunku", "followers murah", "jual followers", "tambah followers", "open order", "open po", "dm for price", "fast respon", "ready stock", "f4f", "faf", "l4l", "lal", "like for like", "follow for follow", "saling dukung", "saling support", "order sekarang", "beli sekarang", "buruan order", "stok terbatas", "beli 2 gratis"),
  ...t(2.0, "first", "pertama", "akun aku", "channel aku", "follow aku", "subscribe channel", "like dan subscribe", "aku follow", "udah aku follow", "sudah aku follow", "subs duluan", "udah subs", "mampir dong", "ready", "jual", "promo", "dropship", "reseller", "jasa", "order", "shopee", "link di bio"),
];

/** Konteks wajar untuk kata yang mirip pelecehan: sewa per jam, sakit perut, resep, produk, bayi, hewan. */
export const SEXUAL_INNOCENT: Term[] = t(
  1,
  "mules", "diare", "mencret", "pedes", "pedas", "seblak", "kebelet", "sakit perut", "makan", "sambel", "sambal", "perut", "masuk angin", "keracunan", "obat", "kekenyangan", "minum", "kopi", "sewa", "rental", "les", "kursus", "parkir", "lapangan",
  "ojol", "ojek", "carter", "resep", "tutorial", "harga", "katalog", "produk", "merk", "merek", "bayi", "ponakan", "kucing", "ikan", "ternak",
  "olahraga", "yoga", "lagu", "hujan", "kehujanan", "bangun tidur", "tidur", "nangis", "terharu", "sedih", "mewek", "baper", "rewel", "konser", "kostum", "gorengan", "pengumuman", "episode", "materi", "beli di mana", "pakai hp",
);
