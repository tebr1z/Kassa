'use strict';

(() => {
  const labels = {
    az: {
      title: 'RestaMarket · Yeniləmələr', eyebrow: 'Masaüstü proqram', section: 'PROQRAM YENİLƏMƏLƏRİ',
      heading: 'Proqramı yeniləyin', idle: 'Yeni versiyaları buradan yoxlayın və proqramı yenidən qurmadan yeniləyin.',
      checkingHeading: 'Yeniləmələr yoxlanılır', checking: 'Yeni versiya haqqında məlumat alınır. Bir az gözləyin.',
      currentHeading: 'Proqramınız yenidir', current: 'Hazırda sizin üçün daha yeni versiya yoxdur. İşinizə davam edə bilərsiniz.',
      availableHeading: 'Yeni versiya hazırdır', available: 'Yeniləməni indi yükləyin, sizin üçün uyğun vaxtda quraşdırın.',
      downloadingHeading: 'Yeniləmə yüklənir', downloading: 'Yükləmə gedərkən proqramdan istifadə edə bilərsiniz. İnternet bağlantısını saxlayın.',
      downloadedHeading: 'Quraşdırmağa hazırdır', downloaded: 'Satışı tamamlayın və dəyişiklikləri saxlayın. Quraşdırma zamanı proqram bağlanacaq.',
      installingHeading: 'Yeniləmə hazırlanır', installing: 'Ehtiyat nüsxə və yenidən açılma hazırlanır. Proqramı məcburi bağlamayın.',
      errorHeading: 'Yeniləmə tamamlanmadı', error: 'İnternet bağlantısını yoxlayıb yenidən cəhd edin. Hazırkı versiya ilə işləməyə davam edə bilərsiniz.',
      disabled: 'Onlayn yeniləmələr bu quraşdırmada aktiv deyil. Dəstək ilə əlaqə saxlayın.',
      startupError: 'Yeniləmə xidməti ilə əlaqə qurulmadı. Pəncərəni bağlayıb yenidən açın.',
      check: 'Yeniləmələri yoxla', download: 'Yüklə', install: 'Quraşdır və yenidən aç', cancel: 'Ləğv et',
      notes: 'Bu versiyada', progress: 'Yüklənir', progressUnknown: 'Hazırlanır…', newVersion: 'Yeni versiya', currentVersion: 'Hazırkı versiya',
      safety: 'Quraşdırmadan əvvəl satışı tamamlayın. Yerli məlumatların ehtiyat nüsxəsi yaradılacaq. Quraşdırma üçün Baş rəhbər girişi tələb olunur.',
    },
    en: {
      title: 'RestaMarket · Updates', eyebrow: 'Desktop application', section: 'APPLICATION UPDATES',
      heading: 'Keep your app up to date', idle: 'Check for new versions here and update without reinstalling the app yourself.',
      checkingHeading: 'Checking for updates', checking: 'Getting information about the latest version. Please wait.',
      currentHeading: 'You are up to date', current: 'No newer version is currently available for you. You can continue working.',
      availableHeading: 'A new version is ready', available: 'Download the update now and install it when convenient.',
      downloadingHeading: 'Downloading the update', downloading: 'You can keep working while the download continues. Stay connected to the internet.',
      downloadedHeading: 'Ready to install', downloaded: 'Finish your sale and save your changes. The app will close during installation.',
      installingHeading: 'Preparing the update', installing: 'Preparing a backup and restart. Do not force-close the app.',
      errorHeading: 'Update not completed', error: 'Check your internet connection and try again. You can continue using the current version.',
      disabled: 'Online updates are not enabled for this installation. Contact support.',
      startupError: 'Could not connect to the update service. Close this window and open it again.',
      check: 'Check for updates', download: 'Download', install: 'Install and restart', cancel: 'Cancel',
      notes: 'In this version', progress: 'Downloading', progressUnknown: 'Preparing…', newVersion: 'New version', currentVersion: 'Current version',
      safety: 'Finish your sale before installation. Local data will be backed up. The head administrator must be signed in to install.',
    },
    ru: {
      title: 'RestaMarket · Обновления', eyebrow: 'Программа для компьютера', section: 'ОБНОВЛЕНИЯ ПРОГРАММЫ',
      heading: 'Обновляйте программу', idle: 'Проверяйте новые версии здесь и обновляйте программу без ручной переустановки.',
      checkingHeading: 'Проверяем обновления', checking: 'Получаем информацию о новой версии. Пожалуйста, подождите.',
      currentHeading: 'У вас актуальная версия', current: 'Более новая версия пока недоступна. Вы можете продолжить работу.',
      availableHeading: 'Новая версия готова', available: 'Загрузите обновление сейчас и установите в удобное время.',
      downloadingHeading: 'Загрузка обновления', downloading: 'Во время загрузки можно продолжать работу. Сохраняйте подключение к интернету.',
      downloadedHeading: 'Всё готово к установке', downloaded: 'Завершите продажу и сохраните изменения. На время установки программа закроется.',
      installingHeading: 'Подготовка обновления', installing: 'Готовим резервную копию и перезапуск. Не закрывайте программу принудительно.',
      errorHeading: 'Обновление не завершено', error: 'Проверьте подключение к интернету и повторите попытку. Можно продолжить работу с текущей версией.',
      disabled: 'Онлайн-обновления для этой установки не включены. Обратитесь в поддержку.',
      startupError: 'Не удалось подключиться к службе обновлений. Закройте это окно и откройте снова.',
      check: 'Проверить обновления', download: 'Загрузить', install: 'Установить и перезапустить', cancel: 'Отмена',
      notes: 'В этой версии', progress: 'Загрузка', progressUnknown: 'Подготовка…', newVersion: 'Новая версия', currentVersion: 'Текущая версия',
      safety: 'Завершите продажу перед установкой. Локальные данные будут сохранены в резервной копии. Для установки требуется вход главного администратора.',
    },
    tr: {
      title: 'RestaMarket · Güncellemeler', eyebrow: 'Masaüstü uygulaması', section: 'UYGULAMA GÜNCELLEMELERİ',
      heading: 'Uygulamayı güncel tutun', idle: 'Yeni sürümleri buradan denetleyin ve uygulamayı kendiniz yeniden kurmadan güncelleyin.',
      checkingHeading: 'Güncellemeler denetleniyor', checking: 'Yeni sürüm bilgileri alınıyor. Lütfen bekleyin.',
      currentHeading: 'Uygulamanız güncel', current: 'Şu anda sizin için daha yeni bir sürüm yok. Çalışmaya devam edebilirsiniz.',
      availableHeading: 'Yeni sürüm hazır', available: 'Güncellemeyi şimdi indirin, uygun olduğunuzda yükleyin.',
      downloadingHeading: 'Güncelleme indiriliyor', downloading: 'İndirme sürerken çalışmaya devam edebilirsiniz. İnternet bağlantısını koruyun.',
      downloadedHeading: 'Yüklemeye hazır', downloaded: 'Satışı tamamlayın ve değişiklikleri kaydedin. Yükleme sırasında uygulama kapanacak.',
      installingHeading: 'Güncelleme hazırlanıyor', installing: 'Yedekleme ve yeniden başlatma hazırlanıyor. Uygulamayı zorla kapatmayın.',
      errorHeading: 'Güncelleme tamamlanamadı', error: 'İnternet bağlantısını denetleyip tekrar deneyin. Mevcut sürümü kullanmaya devam edebilirsiniz.',
      disabled: 'Bu kurulumda çevrimiçi güncellemeler etkin değil. Destek ile iletişime geçin.',
      startupError: 'Güncelleme hizmetine bağlanılamadı. Pencereyi kapatıp yeniden açın.',
      check: 'Güncellemeleri denetle', download: 'İndir', install: 'Yükle ve yeniden başlat', cancel: 'İptal',
      notes: 'Bu sürümde', progress: 'İndiriliyor', progressUnknown: 'Hazırlanıyor…', newVersion: 'Yeni sürüm', currentVersion: 'Mevcut sürüm',
      safety: 'Yüklemeden önce satışı tamamlayın. Yerel veriler yedeklenecek. Yükleme için baş yönetici giriş yapmalıdır.',
    },
    zh: {
      title: 'RestaMarket · 更新', eyebrow: '桌面应用', section: '应用更新',
      heading: '保持应用最新', idle: '在这里检查新版本，无需手动重新安装即可更新应用。',
      checkingHeading: '正在检查更新', checking: '正在获取最新版本信息，请稍候。',
      currentHeading: '已是最新版本', current: '目前没有适用于您的新版本。您可以继续工作。',
      availableHeading: '新版本已就绪', available: '现在下载更新，在方便时安装。',
      downloadingHeading: '正在下载更新', downloading: '下载期间您可以继续工作，请保持网络连接。',
      downloadedHeading: '可以安装了', downloaded: '请完成销售并保存更改。安装期间应用将关闭。',
      installingHeading: '正在准备更新', installing: '正在准备备份和重启，请勿强制关闭应用。',
      errorHeading: '更新未完成', error: '请检查网络连接后重试。您可以继续使用当前版本。',
      disabled: '此安装尚未启用在线更新，请联系支持人员。',
      startupError: '无法连接更新服务，请关闭此窗口后重新打开。',
      check: '检查更新', download: '下载', install: '安装并重启', cancel: '取消',
      notes: '此版本中的更改', progress: '正在下载', progressUnknown: '正在准备…', newVersion: '新版本', currentVersion: '当前版本',
      safety: '请在安装前完成销售。系统将备份本地数据。安装更新需要主管理员登录。',
    },
  };

  const phases = new Set(['idle', 'checking', 'current', 'available', 'downloading', 'downloaded', 'installing', 'error']);
  const ids = ['eyebrow', 'section-label', 'heading', 'description', 'current-version', 'new-version', 'status-icon',
    'progress-block', 'progress-label', 'progress-value', 'progress', 'release-notes', 'notes-heading', 'notes-content',
    'error', 'check', 'download', 'install', 'cancel', 'safety-note'];
  const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const card = document.querySelector('.update-card');
  const bridge = window.restaUpdate;
  const pending = new Set();
  let state = { phase: 'checking', currentVersion: '', language: 'az', enabled: false, progress: null };
  let localError = '';
  let receivedEvent = false;

  function cleanString(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }

  function acceptState(next) {
    if (!next || typeof next !== 'object' || !phases.has(next.phase)) throw new TypeError('Invalid update state.');
    state = {
      phase: next.phase,
      language: Object.hasOwn(labels, next.language) ? next.language : 'az',
      currentVersion: cleanString(next.currentVersion, 64),
      version: cleanString(next.version, 64),
      notes: cleanString(next.notes, 10000),
      error: cleanString(next.error, 1200),
      progress: typeof next.progress === 'number' && Number.isFinite(next.progress) ? Math.min(100, Math.max(0, next.progress)) : null,
      enabled: next.enabled === true,
    };
    localError = '';
    render();
  }

  function render() {
    const text = labels[state.language];
    const phase = state.phase;
    const hasError = Boolean(localError || state.error);
    const headingKey = phase === 'idle' ? 'heading' : `${phase}Heading`;
    document.documentElement.lang = state.language;
    document.title = text.title;
    elements.eyebrow.textContent = text.eyebrow;
    elements['section-label'].textContent = text.section;
    elements.heading.textContent = text[headingKey] || text.heading;
    elements.description.textContent = !state.enabled && phase !== 'checking' ? text.disabled : text[phase] || text.idle;
    elements['current-version'].textContent = state.currentVersion ? `v${state.currentVersion}` : '';
    elements['current-version'].setAttribute('aria-label', `${text.currentVersion}: ${state.currentVersion}`);
    elements['new-version'].hidden = !state.version || !['available', 'downloading', 'downloaded', 'installing'].includes(phase);
    elements['new-version'].textContent = `${text.newVersion}: ${state.version || ''}`;
    elements['status-icon'].textContent = phase === 'current' ? '✓' : phase === 'error' ? '!' : phase === 'downloaded' ? '✓' : '↓';
    elements['safety-note'].textContent = text.safety;
    elements['notes-heading'].textContent = text.notes;
    elements['notes-content'].textContent = state.notes || '';
    elements['release-notes'].hidden = !state.notes || ['idle', 'checking', 'current'].includes(phase);
    elements.error.textContent = localError || state.error || '';
    elements.error.hidden = !hasError;
    elements['progress-block'].hidden = phase !== 'downloading';
    elements['progress-label'].textContent = text.progress;
    elements.progress.setAttribute('aria-label', text.progress);
    elements['progress-value'].textContent = state.progress === null ? text.progressUnknown : `${Math.round(state.progress)}%`;
    if (state.progress === null) elements.progress.removeAttribute('value');
    else elements.progress.value = state.progress;
    const shown = {
      check: ['idle', 'current', 'error'].includes(phase),
      download: phase === 'available',
      install: phase === 'downloaded',
      cancel: ['checking', 'downloading'].includes(phase) && state.enabled,
    };
    for (const action of ['check', 'download', 'install', 'cancel']) {
      const button = elements[action];
      button.textContent = text[action];
      button.hidden = !shown[action];
      button.disabled = !state.enabled || (action === 'cancel' ? pending.has('cancel') : pending.size > 0);
    }
    card.setAttribute('aria-busy', String(pending.size > 0 || ['checking', 'downloading', 'installing'].includes(phase)));
    const active = document.activeElement;
    if (active && ['check', 'download', 'install', 'cancel'].some(id => elements[id] === active) && active.hidden) {
      const next = ['download', 'install', 'check', 'cancel'].map(id => elements[id]).find(button => !button.hidden && !button.disabled);
      if (next) next.focus();
    }
  }

  async function action(name) {
    const button = elements[name];
    if (button.disabled || button.hidden || !bridge || typeof bridge[name] !== 'function') return;
    // Repeated clicks cannot create duplicate checks, downloads or installations.
    if (name === 'cancel' ? pending.has('cancel') : pending.size > 0) return;
    pending.add(name);
    localError = '';
    render();
    try { acceptState(await bridge[name]()); }
    catch { localError = labels[state.language].startupError; }
    finally { pending.delete(name); render(); }
  }

  for (const name of ['check', 'download', 'install', 'cancel']) elements[name].addEventListener('click', () => { void action(name); });

  async function start() {
    render();
    try {
      if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.onState !== 'function') throw new Error('Missing update bridge.');
      const unsubscribe = bridge.onState(next => {
        try { acceptState(next); receivedEvent = true; }
        catch { localError = labels[state.language].startupError; render(); }
      });
      window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
      const initial = await bridge.getState();
      // Do not overwrite a newer broadcast with a slower initial IPC response.
      if (!receivedEvent) acceptState(initial);
    } catch {
      state = { ...state, phase: 'error', enabled: false };
      localError = labels[state.language].startupError;
      render();
    }
  }

  void start();
})();
