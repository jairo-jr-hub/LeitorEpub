const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const bookshelf = document.getElementById('bookshelf');
const fileInput = document.getElementById('file-input');
const settingsModal = document.getElementById('settings-modal');

let currentBook = null;
let rendition = null;

// Configurações persistentes inspiradas no Play Livros
let readerSettings = JSON.parse(localStorage.getItem('reader_settings')) || {
    fontSize: 100,
    fontFamily: 'Original',
    lineHeight: 1.5,
    textAlign: 'justify',
    theme: 'sepia', 
    brightness: 100
};

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    initUIEvents();
});

// --- BIBLIOTECA (Gerenciamento do IndexedDB) ---
async function loadLibrary() {
    bookshelf.innerHTML = '';
    const library = await localforage.getItem('library_metadata') || [];
    
    if (library.length === 0) {
        bookshelf.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666; margin-top: 20px;">Nenhum livro. Adicione um EPUB.</p>';
        return;
    }

    library.forEach(bookMeta => {
        const div = document.createElement('div');
        div.className = 'book-item';
        div.onclick = () => openBook(bookMeta.id);

        // --- BOTÃO DE EXCLUIR (Três Pontinhos) ---
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '⋮';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation(); // Impede que o clique abra o livro
            if (confirm(`Deseja excluir o livro "${bookMeta.title}" do seu dispositivo?`)) {
                await localforage.removeItem(bookMeta.id); // Remove o arquivo pesado
                const novaBiblioteca = library.filter(b => b.id !== bookMeta.id); // Remove da lista
                await localforage.setItem('library_metadata', novaBiblioteca);
                loadLibrary(); // Atualiza a tela
            }
        };

        const img = document.createElement('img');
        img.className = 'book-cover';
        img.src = bookMeta.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23ddd"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">Sem Capa</text></svg>';
        
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = bookMeta.title;

        div.appendChild(deleteBtn); // Adiciona o botão na capa
        div.appendChild(img);
        div.appendChild(title);
        bookshelf.appendChild(div);
    });
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    document.querySelector('.upload-btn').childNodes[0].textContent = "Processando...";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const bookData = ePub(arrayBuffer);
        await bookData.ready;
        const metadata = await bookData.loaded.metadata;
        
        let coverBase64 = null;
        try {
            const coverUrl = await bookData.coverUrl();
            if (coverUrl) {
                const response = await fetch(coverUrl);
                const blob = await response.blob();
                coverBase64 = await new Promise(res => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
            }
        } catch(e) {}

        const bookId = 'book_' + Date.now();
        await localforage.setItem(bookId, arrayBuffer);

        const library = await localforage.getItem('library_metadata') || [];
        library.push({ id: bookId, title: metadata.title, cover: coverBase64, cfi: null });
        await localforage.setItem('library_metadata', library);

        await loadLibrary();
    } catch (error) {
        alert("Erro ao processar o arquivo.");
    } finally {
        document.querySelector('.upload-btn').childNodes[0].textContent = "Adicionar EPUB";
        fileInput.value = '';
    }
});

// --- RENDERIZAÇÃO DO LIVRO (MUITO MAIS ROBUSTA) ---
async function openBook(bookId) {
    libraryView.style.display = 'none';
    readerView.style.display = 'block';
    
    readerView.classList.add('ui-hidden');
    settingsModal.classList.add('hidden');

    try {
        const arrayBuffer = await localforage.getItem(bookId);
        currentBook = ePub(arrayBuffer);
        
        rendition = currentBook.renderTo('viewer', {
            width: '100%',
            height: '100%',
            spread: 'none',
            manager: 'continuous',
            flow: 'paginated'
        });

        // Registra os Temas
        rendition.themes.register("light", { "body": { "background": "#ffffff !important", "color": "#000000 !important" }});
        rendition.themes.register("sepia", { "body": { "background": "#fdfaf6 !important", "color": "#4b3d32 !important" }});
        rendition.themes.register("dark", { "body": { "background": "#121212 !important", "color": "#e0e0e0 !important" }});
        
        // Aplica configurações Iniciais antes de exibir
        rendition.themes.select(readerSettings.theme);
        rendition.themes.fontSize(readerSettings.fontSize + "%");
        if(readerSettings.fontFamily !== 'Original') {
            rendition.themes.font(readerSettings.fontFamily);
        }

        // A injeção de CSS nativo agora só acontece DEPOIS que o conteúdo nasce
        rendition.hooks.content.register((contents) => {
            const style = contents.document.createElement('style');
            style.id = 'epub-dynamic-styles';
            style.innerHTML = `
                body {
                    padding: 40px 20px !important; margin: 0 !important; background-color: transparent !important;
                    line-height: ${readerSettings.lineHeight} !important;
                    text-align: ${readerSettings.textAlign} !important;
                }
                p { text-align: ${readerSettings.textAlign} !important; }
            `;
            contents.document.head.appendChild(style);
        });

        // Configura fundo externo e brilho instantaneamente
        const bgColors = { 'light': '#ffffff', 'sepia': '#fdfaf6', 'dark': '#121212' };
        readerView.style.background = bgColors[readerSettings.theme];
        aplicarBrilho();

        const library = await localforage.getItem('library_metadata');
        const bookMeta = library.find(b => b.id === bookId);
        
        // Exibe a página IMEDIATAMENTE (sem esperar as localizações)
        if (bookMeta && bookMeta.cfi) {
            try { await rendition.display(bookMeta.cfi); } 
            catch(e) { await rendition.display(); }
        } else {
            await rendition.display();
        }

        // Geração da barra de progresso executada em SEGUNDO PLANO para não travar o celular
        currentBook.ready.then(() => {
            return currentBook.locations.generate(1600);
        }).then(locations => {
            // Atualiza o progresso visual assim que terminar o cálculo
            if(rendition.location) {
                const percentage = currentBook.locations.percentageFromCfi(rendition.location.start.cfi);
                const percentRounded = Math.round(percentage * 100);
                document.getElementById('progress-slider').value = percentRounded;
                document.getElementById('page-info').textContent = `${percentRounded}%`;
            }
        });

        rendition.on('relocated', async (location) => {
            bookMeta.cfi = location.start.cfi;
            await localforage.setItem('library_metadata', library);
            
            if(currentBook.locations.length > 0) {
                const percentage = currentBook.locations.percentageFromCfi(location.start.cfi);
                const percentRounded = Math.round(percentage * 100);
                document.getElementById('progress-slider').value = percentRounded;
                document.getElementById('page-info').textContent = `${percentRounded}%`;
            }
        });

    } catch (e) {
        console.error("Erro fatal ao abrir livro:", e);
        fecharLivro();
        alert("Falha ao abrir o livro. Tente excluí-lo e adicionar novamente.");
    }
}

function fecharLivro() {
    if (currentBook) { currentBook.destroy(); currentBook = null; rendition = null; }
    document.getElementById('viewer').innerHTML = '';
    readerView.style.display = 'none';
    libraryView.style.display = 'block';
}

// --- INTERAÇÕES DA UI ---
function initUIEvents() {
    document.getElementById('zone-left').addEventListener('click', () => { if (rendition) rendition.prev(); fecharMenus(); });
    document.getElementById('zone-right').addEventListener('click', () => { if (rendition) rendition.next(); fecharMenus(); });
    
    document.getElementById('zone-center').addEventListener('click', () => {
        const isHidden = readerView.classList.contains('ui-hidden');
        if (isHidden) { readerView.classList.remove('ui-hidden'); } 
        else { fecharMenus(); }
    });

    document.getElementById('btn-back').addEventListener('click', fecharLivro);
    document.getElementById('btn-aa').addEventListener('click', () => settingsModal.classList.toggle('hidden'));

    function fecharMenus() {
        readerView.classList.add('ui-hidden');
        settingsModal.classList.add('hidden');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
        });
    });

    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            readerSettings.fontFamily = e.currentTarget.dataset.font;
            aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig();
        });
    });

    document.getElementById('btn-font-plus').addEventListener('click', () => { readerSettings.fontSize += 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });
    document.getElementById('btn-font-minus').addEventListener('click', () => { if(readerSettings.fontSize > 50) readerSettings.fontSize -= 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });

    document.getElementById('btn-line-plus').addEventListener('click', () => { readerSettings.lineHeight += 0.1; atualizarStylesInjetados(); salvarConfig(); });
    document.getElementById('btn-line-minus').addEventListener('click', () => { if(readerSettings.lineHeight > 1.0) readerSettings.lineHeight -= 0.1; atualizarStylesInjetados(); salvarConfig(); });

    document.getElementById('text-align-select').addEventListener('change', (e) => { readerSettings.textAlign = e.target.value; atualizarStylesInjetados(); salvarConfig(); });

    document.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => { readerSettings.theme = e.target.dataset.theme; aplicarConfiguracoesDinamicas(); salvarConfig(); });
    });

    document.getElementById('brightness-slider').addEventListener('input', (e) => { readerSettings.brightness = e.target.value; aplicarBrilho(); salvarConfig(); });

    atualizarUI(); 
}

// --- FUNÇÕES DE ATUALIZAÇÃO VISUAL ---
function salvarConfig() { localStorage.setItem('reader_settings', JSON.stringify(readerSettings)); }

// Executada APÓS o livro já estar aberto na tela para mudar configs
function aplicarConfiguracoesDinamicas() {
    if (!rendition) return;
    
    rendition.themes.select(readerSettings.theme);
    const bgColors = { 'light': '#ffffff', 'sepia': '#fdfaf6', 'dark': '#121212' };
    readerView.style.background = bgColors[readerSettings.theme];

    rendition.themes.fontSize(readerSettings.fontSize + "%");
    if(readerSettings.fontFamily !== 'Original') rendition.themes.font(readerSettings.fontFamily);
    else rendition.themes.font(''); 

    atualizarStylesInjetados();
    aplicarBrilho();
}

function atualizarStylesInjetados() {
    if (!rendition) return;
    try {
        rendition.getContents().forEach(content => {
            let style = content.document.getElementById('epub-dynamic-styles');
            if (style) {
                style.innerHTML = `
                    body {
                        padding: 40px 20px !important; margin: 0 !important; background-color: transparent !important;
                        line-height: ${readerSettings.lineHeight} !important;
                        text-align: ${readerSettings.textAlign} !important;
                    }
                    p { text-align: ${readerSettings.textAlign} !important; }
                `;
            }
        });
    } catch(e) { console.warn("Não foi possível atualizar o CSS injetado agora.", e) }
}

function aplicarBrilho() {
    const overlay = document.getElementById('brightness-overlay');
    const darkness = 1 - (readerSettings.brightness / 100);
    overlay.style.opacity = darkness;
}

function atualizarUI() {
    document.getElementById('font-size-display').textContent = readerSettings.fontSize + '%';
    document.getElementById('text-align-select').value = readerSettings.textAlign;
    document.getElementById('brightness-slider').value = readerSettings.brightness;
    aplicarBrilho();
    document.querySelectorAll('.font-btn').forEach(btn => { btn.classList.toggle('selected', btn.dataset.font === readerSettings.fontFamily); });
}
