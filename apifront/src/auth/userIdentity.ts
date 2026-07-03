export function isAtilioVarelaUser(user: any): boolean {
  const text = `${user?.nombre ?? ''} ${user?.email ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return text.includes('atilio') && text.includes('varela');
}
