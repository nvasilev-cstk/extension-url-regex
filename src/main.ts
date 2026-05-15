import ContentstackAppSDK from '@contentstack/app-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtensionConfig {
  /** UID of the OOB URL field in the same content type to keep in sync. */
  target_field_uid?: string;
  /**
   * Optional regex pattern the URL must match (applied after structural
   * validation). Example: "^https://example\\.com" to restrict to one domain.
   */
  validation_regex?: string;
  /** Error message shown when validation_regex does not match. */
  validation_message?: string;
  /**
   * List of words (case-insensitive) that must not appear anywhere in the value.
   * Example: ["admin", "login", "wp-admin"]
   */
  forbidden_words?: string[];
}

interface ValidationResult {
  valid: boolean;
  empty: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Validates a URL string using the native URL constructor.
 * Mirrors the validation Contentstack applies to its built-in URL fields:
 * must be a well-formed absolute URL with an http/https/ftp scheme.
 *
 * If regex is provided it is applied as an additional check after structural
 * validation — both must pass for the URL to be considered valid.
 */
function validateUrl(
  raw: string,
  regex?: RegExp,
  regexMessage?: string,
  forbiddenWords?: string[],
): ValidationResult {
  const url = raw.trim();

  if (url === '') {
    return { valid: true, empty: true };
  }

  // Step 1: format check — regex (when configured) or structural URL check.
  if (regex) {
    if (!regex.test(url)) {
      return {
        valid: false,
        empty: false,
        message: regexMessage ?? 'Value does not match the required format',
      };
    }
  } else {
    try {
      const parsed = new URL(url);
      const allowed = ['http:', 'https:', 'ftp:'];
      if (!allowed.includes(parsed.protocol)) {
        return {
          valid: false,
          empty: false,
          message: 'URL must start with http://, https://, or ftp://',
        };
      }
      // Require at least one dot in the hostname (reject bare "http://localhost"-style for production)
      // but allow localhost explicitly so local development still works.
      if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
        return {
          valid: false,
          empty: false,
          message: 'URL must include a valid domain (e.g., example.com)',
        };
      }
    } catch {
      return {
        valid: false,
        empty: false,
        message: 'Please enter a valid URL (e.g., https://example.com)',
      };
    }
  }

  // Step 2: forbidden words — always runs after step 1 passes.
  if (forbiddenWords && forbiddenWords.length > 0) {
    const lower = url.toLowerCase();
    const hit = forbiddenWords.find((w) => lower.includes(w.toLowerCase()));
    if (hit) {
      return {
        valid: false,
        empty: false,
        message: `URL must not contain "${hit}"`,
      };
    }
  }

  return { valid: true, empty: false };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const inputGroup = document.getElementById('inputGroup') as HTMLDivElement;
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const validationIcon = document.getElementById('validationIcon') as HTMLSpanElement;
const errorMessage = document.getElementById('errorMessage') as HTMLDivElement;
const syncStatus = document.getElementById('syncStatus') as HTMLDivElement;
const syncDot = document.getElementById('syncDot') as HTMLSpanElement;
const syncLabel = document.getElementById('syncLabel') as HTMLSpanElement;

function setValidationUI(result: ValidationResult): void {
  // Reset state classes
  inputGroup.classList.remove('state-valid', 'state-invalid');
  validationIcon.classList.remove('visible', 'icon-valid', 'icon-invalid');
  errorMessage.classList.remove('visible');

  if (result.empty) {
    validationIcon.textContent = '';
    errorMessage.textContent = '';
    return;
  }

  if (result.valid) {
    inputGroup.classList.add('state-valid');
    validationIcon.classList.add('visible', 'icon-valid');
    validationIcon.textContent = '✓';
    errorMessage.textContent = '';
  } else {
    inputGroup.classList.add('state-invalid');
    validationIcon.classList.add('visible', 'icon-invalid');
    validationIcon.textContent = '✕';
    errorMessage.textContent = result.message ?? 'Invalid URL';
    errorMessage.classList.add('visible');
  }
}

type SyncState = 'syncing' | 'ok' | 'error' | 'hidden';

let syncHideTimer: ReturnType<typeof setTimeout> | null = null;

function setSyncUI(state: SyncState, label = ''): void {
  if (syncHideTimer) {
    clearTimeout(syncHideTimer);
    syncHideTimer = null;
  }

  if (state === 'hidden') {
    syncStatus.classList.remove('visible');
    return;
  }

  syncDot.className = 'sync-dot';
  if (state === 'syncing') syncDot.classList.add('dot-syncing');
  if (state === 'ok') syncDot.classList.add('dot-ok');
  if (state === 'error') syncDot.classList.add('dot-error');

  syncLabel.textContent = label;
  syncStatus.classList.add('visible');

  if (state === 'ok') {
    // Auto-hide the "Synced" confirmation after a moment
    syncHideTimer = setTimeout(() => syncStatus.classList.remove('visible'), 1800);
  }
}

// ---------------------------------------------------------------------------
// Extension logic
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdk: any;
  try {
    sdk = await ContentstackAppSDK.init();
  } catch (err) {
    // Running outside Contentstack — show a demo state so local dev is usable
    console.warn('[URLExtension] SDK init failed (not inside Contentstack?):', err);
    attachStandaloneListeners();
    return;
  }

  const customField = sdk.location?.CustomField;
  if (!customField) {
    console.error('[URLExtension] Not running in a CustomField location.');
    return;
  }

  // Resize the iframe to fit content rather than using a fixed height
  customField.frame?.enableAutoResizing();

  const field = customField.field;
  const entry = customField.entry;
  const config: ExtensionConfig = customField.fieldConfig ?? {};
  const targetUid = config.target_field_uid;

  // Compile the config regex once; warn and ignore if the pattern is invalid.
  let configRegex: RegExp | undefined;
  if (config.validation_regex) {
    try {
      configRegex = new RegExp(config.validation_regex);
    } catch {
      console.warn(
        `[URLExtension] Invalid validation_regex "${config.validation_regex}" — ignored.`,
      );
    }
  }
  const configRegexMessage = config.validation_message;
  const forbiddenWords = config.forbidden_words ?? [];

  // ------------------------------------------------------------------
  // Resolve the target OOB URL field (optional)
  // ------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let targetField: any = null;
  if (targetUid) {
    try {
      targetField = entry.getField(targetUid);
    } catch (err) {
      console.warn(`[URLExtension] Could not find target field "${targetUid}":`, err);
    }
  }

  // ------------------------------------------------------------------
  // Seed the input with the current saved value.
  // Priority: own extension field → OOB target field.
  // ------------------------------------------------------------------
  const ownValue: string = field.getData() ?? '';
  let seedValue = ownValue;

  if (!seedValue && targetField) {
    const oobRaw = targetField.getData();
    // A Contentstack "Link" field stores { href, title }; text fields store a string.
    if (oobRaw && typeof oobRaw === 'object' && 'href' in oobRaw) {
      seedValue = (oobRaw as { href: string }).href ?? '';
    } else if (typeof oobRaw === 'string') {
      seedValue = oobRaw;
    }
  }

  urlInput.value = seedValue;
  setValidationUI(validateUrl(seedValue, configRegex, configRegexMessage, forbiddenWords));

  // ------------------------------------------------------------------
  // Bidirectional sync: OOB field → extension input
  // When someone edits the OOB field directly (e.g. via API or another
  // extension), keep our input up to date.
  // ------------------------------------------------------------------
  if (targetField) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    targetField.onChange((data: any) => {
      const incoming =
        data && typeof data === 'object' && 'href' in data
          ? (data as { href: string }).href ?? ''
          : String(data ?? '');

      // Only update if it actually differs to avoid cursor-position resets
      if (incoming !== urlInput.value) {
        urlInput.value = incoming;
        setValidationUI(validateUrl(incoming, configRegex, configRegexMessage, forbiddenWords));
      }
    });
  }

  // ------------------------------------------------------------------
  // Sync helper: writes value into both fields
  // ------------------------------------------------------------------
  async function syncValue(url: string): Promise<void> {
    const promises: Promise<void>[] = [];

    // Always write to the extension's own field
    promises.push(
      (field.setData(url) as Promise<void>).catch((err: unknown) => {
        console.error('[URLExtension] setData on own field failed:', err);
      }),
    );

    // Write to the OOB URL field when configured
    if (targetField) {
      promises.push(
        (targetField.setData(url) as Promise<void>).catch((err: unknown) => {
          console.warn('[URLExtension] setData on target field failed:', err);
          throw err; // Re-throw so the caller can show the error state
        }),
      );
    }

    await Promise.all(promises);
  }

  // ------------------------------------------------------------------
  // Debounced immediate sync — fires ~150 ms after the last keystroke
  // so every character is captured without hammering the SDK on rapid typing.
  // On blur we also force an unconditional sync as a safety net.
  // ------------------------------------------------------------------
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSync(url: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);

    if (targetField) setSyncUI('syncing', 'Syncing…');

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      try {
        await syncValue(url);
        if (targetField) setSyncUI('ok', 'Synced');
      } catch {
        if (targetField) setSyncUI('error', 'Sync failed — will retry on save');
      }
    }, 1000);
  }

  urlInput.addEventListener('input', () => {
    const url = urlInput.value;
    setValidationUI(validateUrl(url, configRegex, configRegexMessage, forbiddenWords));
    scheduleSync(url);
  });

  urlInput.addEventListener('blur', () => {
    // Flush any pending debounced sync immediately on focus loss
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const url = urlInput.value;
    syncValue(url)
      .then(() => {
        if (targetField) setSyncUI('ok', 'Synced');
      })
      .catch(() => {
        if (targetField) setSyncUI('error', 'Sync failed — will retry on save');
      });
  });
}

// ---------------------------------------------------------------------------
// Standalone mode (local dev / preview outside Contentstack)
// ---------------------------------------------------------------------------

function attachStandaloneListeners(): void {
  urlInput.addEventListener('input', () => {
    setValidationUI(validateUrl(urlInput.value));
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
