# Программа развития и жизненный цикл разработки (SDLC & Roadmap)
## Стратегический план эволюции форка FalafelUI: от стабилизации к студийному AI-редактору

> **Проект**: `Falafel0/FalafelUI`  
> **Базовая версия**: `1.0.0-falafel.1`  
> **Файл**: `docs/DEVELOPMENT_CYCLE_AND_ROADMAP.md`  
> **Методология**: Milestone-Driven Development (MDD) с жесткими критериями качества (Quality Gates) и контрольными точками (Checkpoints).

---

## 1. Стратегические цели и метрики успеха (OKRs)

### Цель 1: Архитектурная надежность и нулевой технический долг (Stability & Hardening)
- **КР 1.1**: 0 утечек памяти при работе с бэкендом (100% очистка `ipcListen` во всех 7 уязвимых компонентах).
- **КР 1.2**: 0 предупреждений Svelte 5 компилятора (`svelte-check` сокращает 91 предупреждение до 0).
- **КР 1.3**: 100% перевод русской локали (`ru.ts` закрывает 829 англоязычных заглушек).
- **КР 1.4**: Устранение избыточного дискового ввода-вывода (внедрение дебаунса 300 мс на `generation.saveSettings()`).

### Цель 2: Профессиональная эргономика и порог входа (UX & Ergonomics)
- **КР 2.1**: Внедрение двухуровневого интерфейса (Simple / Pro Mode) со скрытием избыточных технических деталей для новичков.
- **КР 2.2**: Реорганизация страницы настроек (21 плоская категория группируется в 5 структурированных разделов).
- **КР 2.3**: Оптимизация нижнего трея (разделение 11 вкладок на ассеты, сессию и модальные редакторы).
- **КР 2.4**: Реализация неразрушающего удаления в галерее (Optimistic Delete + 5-секундный Undo-снекбар).

### Цель 3: Полноценный единый холст уровня Photoshop (Unified Canvas Studio)
- **КР 3.1**: Бесшовное объединение `txt2img + img2img + inpainting + upscale` в один холст с автоопределением операции.
- **КР 3.2**: Полный стек слоев: режимы наложения (Blend Modes), прозрачность, дублирование (`Ctrl+J`) и сведение (`Ctrl+E`).
- **КР 3.3**: Интерактивный плавающий контекстный бар задач (HUD) с оперативным вводом промпта и кнопкой апскейла.
- **КР 3.4**: Неразрушающий буфер предпросмотра вариантов (Staging Carousel) прямо на холсте.

### Цель 4: Инженерный лоск профессионального софта (Pro Telemetry & Controls)
- **КР 4.1**: Постоянная строка состояния (Status Bar): живой мониторинг VRAM, статус ComfyUI и прогресс загрузки моделей.
- **КР 4.2**: Интерактивные числовые регуляторы (Scrubbable inputs) с регулировкой перетаскиванием мыши.
- **КР 4.3**: Интеллектуальные бейджи рекомендаций параметров сэмплера и разрешения под модель.

---

## 2. Контрольные точки и этапы разработки (Milestones)

```
[ v1.0.0-falafel.1 ] (Текущий релиз)
        │
        ▼
[ Milestone 1: v1.1.0-falafel ] ──► "Rock Solid" (Устранение утечек, реактивность Svelte 5, русский перевод)
        │
        ▼
[ Milestone 2: v1.2.0-falafel ] ──► "Ergonomic Studio" (Simple/Pro Mode, группы настроек, Undo тосты)
        │
        ▼
[ Milestone 3: v1.3.0-falafel ] ──► "Unified Canvas" (Photoshop-холст, слои, HUD, бесшовный апскейл)
        │
        ▼
[ Milestone 4: v1.4.0-falafel ] ──► "Pro Master" (Status Bar, VRAM телеметрия, скраббинг инпутов)
```

---

### Milestone 1: Релиз `v1.1.0-falafel` — "Rock Solid" (Стабилизация и фундамент)
> **Фокус**: Устранение критических утечек памяти, реактивных багов компилятора и закрытие пробелов локализации.

#### Задачи и рабочий объем (Scope):
1. **Устранение утечек подписок `ipcListen`**:
   - Внедрить массив отписок `onDestroy` в компонентах:
     - [`ControlNetSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/ControlNetSettings.svelte)
     - [`FaceDetectorPicker.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/FaceDetectorPicker.svelte)
     - [`ImageEditSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/ImageEditSettings.svelte)
     - [`SamplerSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/SamplerSettings.svelte)
     - [`UpscaleSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/UpscaleSettings.svelte)
     - [`SetupWizard.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/setup/SetupWizard.svelte)
     - [`ExternalComfyModal.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/ExternalComfyModal.svelte)
2. **Исправление багов реактивности Svelte 5**:
   - Объявить `updateObj` в [`SettingsPage.svelte:1148`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/settings/SettingsPage.svelte#L1148) через `$state(null)`.
   - Обернуть передачу пропса `manifestUrl` в геттер или `$effect` в [`ArtistGalleryPage.svelte:51`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/artist-gallery/components/ArtistGalleryPage.svelte#L51) и [`ArtistHoverPreview.svelte:15`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/artist-gallery/components/ArtistHoverPreview.svelte#L15).
   - Устранить предупреждения доступности (`<label for="...">` и клавиатурные хэндлеры на кликабельных элементах).
3. **Дебаунс записи настроек на диск**:
   - В [`generation.svelte.ts:3186`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/stores/generation.svelte.ts#L3186) обернуть вызов `ipcStore.set()` в дебаунс-таймер 300 мс для исключения параллельных записей при движении ползунков.
4. **100% паритет перевода `ru.ts`**:
   - Перевести 829 оставшихся строк (параметры H3/LTX видео, генерация музыки Suno/YuE2, NovelAI character controls).

#### Критерии готовности (Definition of Done для M1):
- [x] `npm run check` проходит с 0 ошибок и менее 10 предупреждений (было 91).
- [x] Ни один открытый и закрытый аккордеон настроек не оставляет висячих слушателей в `browserListeners`.
- [x] В `ru.ts` отсутствуют англоязычные фразы для пользовательских функций (за исключением имен моделей и терминов).
*(Завершено и зафиксировано в коммите `dffc59a`)*

---

### Milestone 2: Релиз `v1.2.0-falafel` — "Ergonomic Studio" (UI/UX Рефакторинг)
> **Фокус**: Снижение когнитивной нагрузки, двухуровневый интерфейс и комфорт кураторства.

#### Задачи и рабочий объем (Scope):
1. **Реализация Simple / Pro Mode**:
   - Добавить тумблер режима простоты в шапку страницы генерации.
   - В **Simple Mode**:
     - Скрывать разделы сэмплера, расписания, VAE, split CLIP, face detailer, заменяя их компактным селектором стиля и пресетов.
     - Сохранять автовыбор параметров на основе `samplingRecommendation.ts`.
   - В **Pro Mode**:
     - Отображать полный инженерный набор секций.
2. **Иерархическая группировка страницы настроек**:
   - Разбить 21 категорию в [`SettingsPage.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/settings/SettingsPage.svelte) на 5 аккордеонов/групп с иконками:
     - *Общие настройки*
     - *Движок, GPU и пути*
     - *Параметры генерации и тегов*
     - *Интеграции и облачные API*
     - *Сервер, аккаунты и система*
3. **Реорганизация нижнего трея (`BottomPanel.svelte`)**:
   - Разгрузить 11 вкладок: разделить трей на селектор библиотеки `[Ассеты: LoRA / Модели / Персонажи]` и `[Сессия: Картинки / Промпты / Заметки]`.
   - Полноэкранные инструменты (`Compare Grid`, `Style Creator`) открывать в модальных рабочих окнах.
4. **Неразрушающее удаление в галерее**:
   - Заменить модальные окна подтверждения удаления на мгновенное скрытие элемента с появлением всплывающего уведомления: *"Изображение удалено. [Отменить (5 сек)]"*.

#### Критерии готовности (Definition of Done для M2):
- [x] Новый пользователь в Simple Mode может начать генерацию, взаимодействуя максимум с 3 элементами (промпт, модель, формат).
- [x] Высота бокового меню настроек на экране 1080p умещается без вертикального скролла навигационной панели.
- [x] Случайное удаление изображения в галерее обратимо за 1 клик.
*(Завершено и зафиксировано в коммите `1cc0a25`)*

---

### Milestone 3: Релиз `v1.3.0-falafel` — "Unified Canvas Studio" (Единый фотошоп-холст)
> **Фокус**: Слияние txt2img, img2img, inpainting и upscale в единый рабочий документ со слоями.

#### Задачи и рабочий объем (Scope):
1. **Интеллектуальный роутер генерации на холсте**:
   - Интеграция `canvas.currentUnifiedAction` в процесс формирования параметров генерации:
     - Если рамка генерации на чистом холсте -> автозапуск `txt2img`.
     - Если под рамкой есть пиксели и нет маски -> автозапуск `img2img` с ползунком Denoise из HUD.
     - Если нарисована маска -> автозапуск `inpainting / Generative Fill`.
     - Если рамка выходит за границы изображения -> автозапуск `outpainting / Generative Expand`.
2. **Контекстный плавающий бар (Canvas HUD)**:
   - Внедрение [`CanvasContextualBar.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/canvas/CanvasContextualBar.svelte) с привязкой к рамке выделения:
     - Прямой ввод промпта на холсте.
     - Кнопка `Generate` со спиннером шагов.
     - Кнопка `🔍 Upscale Selection` (запуск 2x/4x апскейла выделенного фрагмента).
3. **Полноценные режимы наложения слоев (Konva Canvas)**:
   - Применение `mixBlendMode` к слоям Konva в [`CanvasStage.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/canvas/CanvasStage.svelte):
     - `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten`.
   - Кнопка объединения слоев вниз (`Merge Down`) и сведения видимых (`Flatten`).
4. **Карусель предпросмотра вариантов (In-Place Staging)**:
   - Отображение пачки результатов (1 из 4) прямо внутри рамки холста с кнопками `Принять (Enter)`, `В новый слой (Shift+Enter)`, `Отклонить (Esc)`.

#### Критерии готовности (Definition of Done для M3):
- [x] Пользователь может начать с генерации фона, дорисовать персонажа через кисть-маску, изменить лицо через img2img и увеличить результат через Upscale **на одном экране без единого перехода между вкладками**.
- [x] Слои корректно накладываются с режимами `Multiply` и `Screen`.
- [x] Генерация не перезаписывает базовые слои без явного подтверждения пользователя.
*(Завершено и зафиксировано в коммите `8fd192c`)*

---

### Milestone 4: Релиз `v1.4.0-falafel` — "Pro Master" (Студийная телеметрия и полировка)
> **Фокус**: Профессиональный мониторинг железа, скраббинг инпутов и финальный лоск.

#### Задачи и рабочий объем (Scope):
1. **Строка состояния рабочей станции (Persistent Status Bar)**:
   - Закрепленный в самом низу окна Status Bar:
     - Индикатор здоровья ComfyUI бэкенда (индикатор пинга и статус сервера).
     - Телеметрия GPU: текущая загрузка VRAM (например: `VRAM: 8.2 / 16.0 GB`) и температура.
     - Индикатор фоновых задач (активные загрузки с процентом выполнения, текущая позиция в очереди).
2. **Интерактивные числовые поля (Scrubbable Number Inputs)**:
   - Реализация зажатия мыши на названии параметра (Steps, CFG, Denoise) с протяжкой влево/вправо для плавного изменения значений (как в Blender/Photoshop).
3. **Интеллектуальные бейджи рекомендаций**:
   - Автоматическая подсветка *"Рекомендуемое разрешение"* и *"Оптимальный сэмплер"* на основе типа загруженной модели (SD1.5, SDXL, Pony, Illustrious, Flux, Animagine).

#### Критерии готовности (Definition of Done для M4):
- [x] Пользователь видит реальную загрузку VRAM прямо во время генерации.
- [x] Изменение шагов и CFG доступно через плавный скраббинг мыши без необходимости целиться в ползунок.
- [x] Ошибки CUDA Out of Memory сопровождаются кнопками быстрого решения (Tiled VAE / Снизить разрешение).
*(Завершено и зафиксировано в коммите `d525ea4`)*

---

## 3. Регламент обеспечения качества (Quality Gates)

Перед объединением любого пулл-реквеста или выпуском релиза агент и разработчик обязаны выполнить контрольный чеклист:

```bash
# 1. Сборка фронтенда, паритет переводов, порталы и типизация:
npm run check

# 2. Компиляция десктопного ядра Rust:
cargo check --manifest-path src-tauri/Cargo.toml

# 3. Компиляция серверного бинарника без Tauri:
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features server

# 4. Прогон набора регрессионных тестов (более 920 тестов):
cargo test --manifest-path src-tauri/Cargo.toml
```

### Запрещенные практики (Hard Rules):
- ❌ **Никаких `Co-Authored-By` трейлеров** в коммитах или PR.
- ❌ **Никаких веток с префиксом `claude/...`** или именами других AI-инструментов. Ветки строго `feat/<slug>` или `chore/<slug>`.
- ❌ **Никаких прямых вызовов `invoke` / `listen`** из `@tauri-apps/api`. Использовать исключительно `ipcInvoke` и `ipcListen` из [`src/lib/utils/ipc.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts).
- ❌ **Никаких незакрытых подписок `ipcListen`**: любая подписка обязана регистрировать отписку в `onDestroy()`.

---

## 4. Протокол работы AI-агентов по задачам роадмапа

Когда агент получает задачу на разработку фичи из дорожной карты:
1. **Анализ задачи**: Агент сопоставляет задачу с соответствующим майлстоуном (`M1`..`M4`).
2. **Изолированная ветка**: Агент создает ветку `feat/<slug>` (или работает в `main` для соло-разработки по правилам форка).
3. **Использование мок-среды для UI**:
   - Для быстрой отладки верстки агент открывает страницу с параметром `?preview=main&lang=ru` через [`mockPreview.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/mockPreview.ts), не дожидаясь запуска тяжелого бэкенда ComfyUI.
4. **Валидация Quality Gate**: Агент прогоняет `npm run check` и фиксирует 0 ошибок.
5. **Документирование**: Внесение отметки о выполнении в соответствующий раздел документации.
