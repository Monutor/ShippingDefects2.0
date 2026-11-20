<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="min-h-screen px-4 pt-4 pb-40">
    <div class="max-w-[65rem] mx-auto">
      <button
        class="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors mb-4"
        @click="router.push('/')"
      >
        <van-icon name="arrow-left" size="20" aria-hidden="true" />
        <span class="text-sm font-medium">На главную</span>
      </button>

      <h1 class="text-2xl font-bold text-slate-100 mb-1">Как пользоваться</h1>
      <p class="text-sm text-slate-400 mb-5">
        Короткая инструкция для новых пользователей приложения «Учёт брака».
      </p>

      <!-- 1. Первые шаги -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">🏁</span> Первые шаги
        </h2>
        <ul class="text-sm text-slate-300 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>
            Приложение работает на одном устройстве: все данные хранятся в браузере и интернет не
            нужен.
          </li>
          <li>
            При первом запуске задайте магазин — номер (3 цифры) и текст пломбы. Это в «Настройках»
            (шестерёнка в правом верхнем углу).
          </li>
          <li>На главной загрузите Excel-файл (.xlsx) со списком брака — это справочная база.</li>
          <li>Дальше перемещайтесь по приложению через меню внизу экрана.</li>
        </ul>
      </section>

      <!-- 2. Миксы -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">📦</span> Миксы
        </h2>
        <ul class="text-sm text-slate-300 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>
            Вкладка «Миксы»: создайте короб и сканируйте в него товары — через ТСД или камеру
            телефона.
          </li>
          <li>В поле ввода достаточно номера товара — префикс магазина добавится сам.</li>
          <li>
            В подсказках у товара сразу видно, где он уже лежит: «М7» (микс), «М7 → П3» (микс в
            паллете), «П3» (паллета), «В» (отдельные). Дубликаты приложение не даёт добавить.
          </li>
          <li>Кнопка «Отменить» убирает последние действия — до 50 шагов.</li>
          <li>Кнопка «Сброс» полностью сбрасывает текущий микс.</li>
          <li>Завершённые коробы попадают во вкладку «Результаты».</li>
        </ul>
      </section>

      <!-- 3. Отдельные -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">🔀</span> Отдельные
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Брак, который не кладут в короб и паллет: сканируйте его во вкладку «Отдельные». В поиске
          такие товары помечаются «В».
        </p>
      </section>

      <!-- 4. Паллеты -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">🟨</span> Паллеты
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Вкладка «Паллеты»: добавляйте готовые миксы или товары прямо в паллету(«П»). Готовую
          паллету можно экспортировать в Excel.
        </p>
      </section>

      <!-- 5. Результаты -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">📋</span> Результаты
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Здесь лежат завершённые миксы и паллеты. Каждый можно открыть и выгрузить в Excel — в
          файле будет пломба вашего магазина.
        </p>
      </section>

      <!-- 6. Поиск -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">🔎</span> Поиск
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Ищите товар по номеру, названию или артикулу — поиск покажет, в каком контейнере он лежит.
          Можно искать по месту: наберите «М6», «П12» или «В», и увидите всё содержимое этого места.
        </p>
      </section>

      <!-- 7. База данных -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">🗂</span> База данных
        </h2>
        <p class="text-sm text-slate-300 leading-relaxed">
          Вкладка «База данных» — просмотр загруженного Excel: поиск по любому полю и по месту
          хранения. Новая загрузка файла заменяет базу целиком.
        </p>
      </section>

      <!-- 8. Настройки -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">⚙️</span> Настройки
        </h2>
        <ul class="text-sm text-slate-300 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>«Магазин» — сменить номер и пломбу (осторожно: данные будут очищены).</li>
          <li>«Резервная копия» — сохранить все данные в файл и восстановить их на устройстве.</li>
          <li>«Импорт» — загрузить ранее выгруженные миксы или паллеты.</li>
          <li>«Очистка данных» — полный сброс. Используйте только если уверены.</li>
        </ul>
      </section>

      <!-- 9. ТСД -->
      <section class="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mb-3">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-100 mb-2">
          <span aria-hidden="true">📱</span> Если сканируете ТСД
        </h2>
        <ul class="text-sm text-slate-300 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>
            ТСД работает как клавиатура: код попадает в активное поле «Скан ТСД». Держите его в
            фокусе — тогда сканер сразу ловит товар.
          </li>
          <li>
            Повреждённый штрихкод приложение отклонит с предупреждением — пересканируйте или введите
            номер вручную.
          </li>
        </ul>
      </section>

      <p class="text-xs text-slate-500 italic mt-4">
        Если что-то из этого не получается — спросите у того, кто вам дал приложение.
      </p>
    </div>
  </div>
</template>
