// contacts.js
// Нативный Contact Picker API
// Никаких фреймворков, только чистый JS + ES модули

// ============= ПРОВЕРКА ПОДДЕРЖКИ =============
export function isContactPickerSupported() {
    return 'contacts' in navigator && 'ContactsManager' in window;
}

// ============= ПОЛУЧЕНИЕ ДОСТУПНЫХ ПОЛЕЙ =============
export async function getAvailableFields() {
    if (!isContactPickerSupported()) return [];
    try {
        return await navigator.contacts.getProperties();
    } catch {
        return [];
    }
}

// ============= ОСНОВНАЯ ФУНКЦИЯ ВЫБОРА =============
/**
 * @param {Object} options
 * @param {string[]} options.fields - ['name', 'tel', 'email', 'address', 'icon']
 * @param {boolean} options.multiple - разрешить выбор нескольких контактов
 * @returns {Promise<Object[]>}
 */
export async function pickContacts(options = {}) {
    // 1. Проверка поддержки
    if (!isContactPickerSupported()) {
        throw new Error('Contact Picker API не поддерживается в этом браузере');
    }

    // 2. Поля по умолчанию
    const fields = options.fields?.length 
        ? options.fields 
        : ['name', 'tel'];
    
    const multiple = options.multiple ?? true;

    // 3. Вызов нативного пикера
    try {
        const contacts = await navigator.contacts.select(fields, { multiple });
        return contacts;
    } catch (error) {
        // Пробрасываем оригинальную ошибку
        throw error;
    }
}

// ============= УТИЛИТЫ ДЛЯ РАБОТЫ С КОНТАКТАМИ =============

/**
 * Форматирование одного контакта в строку
 */
export function formatContact(contact) {
    const parts = [];
    
    if (contact.name?.[0]) {
        parts.push(`👤 ${contact.name[0]}`);
    }
    if (contact.tel?.length) {
        parts.push(`📞 ${contact.tel.join(', ')}`);
    }
    if (contact.email?.length) {
        parts.push(`✉️ ${contact.email.join(', ')}`);
    }
    if (contact.address?.length) {
        const addr = contact.address[0];
        const addrStr = [addr.street, addr.city, addr.country]
            .filter(Boolean)
            .join(', ');
        if (addrStr) parts.push(`🏠 ${addrStr}`);
    }
    
    return parts.join(' · ') || 'Нет данных';
}

/**
 * Группировка контактов по первой букве имени
 */
export function groupContactsByLetter(contacts) {
    const groups = {};
    
    contacts.forEach(contact => {
        const name = contact.name?.[0] || '#';
        const letter = name[0]?.toUpperCase() || '#';
        
        if (!groups[letter]) groups[letter] = [];
        groups[letter].push(contact);
    });
    
    // Сортировка по алфавиту
    return Object.keys(groups)
        .sort()
        .reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {});
}

/**
 * Экспорт в vCard (стандартный формат контактов)
 */
export function exportToVCard(contacts) {
    return contacts.map(contact => {
        let vcard = 'BEGIN:VCARD\nVERSION:3.0\n';
        
        // Имя
        if (contact.name?.[0]) {
            vcard += `FN:${contact.name[0]}\n`;
        }
        
        // Телефоны
        if (contact.tel?.length) {
            contact.tel.forEach(phone => {
                vcard += `TEL:${phone}\n`;
            });
        }
        
        // Email
        if (contact.email?.length) {
            contact.email.forEach(email => {
                vcard += `EMAIL:${email}\n`;
            });
        }
        
        // Адрес
        if (contact.address?.length) {
            const addr = contact.address[0];
            const addrParts = [
                addr.street,
                addr.city,
                addr.region,
                addr.postalCode,
                addr.country
            ].filter(Boolean);
            vcard += `ADR:;;${addrParts.join(';')}\n`;
        }
        
        vcard += 'END:VCARD';
        return vcard;
    }).join('\n');
}

/**
 * Экспорт в CSV
 */
export function exportToCSV(contacts) {
    const headers = ['Имя', 'Телефон', 'Email', 'Адрес'];
    const rows = contacts.map(contact => [
        contact.name?.[0] || '',
        contact.tel?.join('; ') || '',
        contact.email?.join('; ') || '',
        contact.address?.[0] 
            ? Object.values(contact.address[0]).filter(Boolean).join(', ')
            : ''
    ]);
    
    return [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
}

// ============= ЗАГРУЗКА ФАЙЛА =============
export function downloadContacts(data, filename, mimeType = 'text/plain') {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}