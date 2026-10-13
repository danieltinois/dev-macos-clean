// What differs between the shells that run this UI: Electron and the Swift app
// on macOS ('mac'), and the iPhone app ('ios'). The shell says which one it is
// through `window.devclean.platform`; everything else in the UI is shared.
export type PlatformId = 'mac' | 'ios';

export interface Platform {
  id: PlatformId;
  device: string;
  // Title bar, scope line and footer.
  mode: string;
  scope: string;
  scopeNote: string;
  footer: string;
  // Where cleanup sends items, as a button, a destination, a place and the cat's cheer.
  send: string;
  toTrash: string;
  inTrash: string;
  cheer: string;
  // How to actually get the space back afterwards (status line and the cat).
  freeSpace: string;
  catFreeSpace: string;
  // Details button that shows the item: in the Finder on the Mac, in Quick Look on the iPhone.
  reveal: string;
  // Shown over the details while the item opens.
  opening: string;
  // Automatic cleanup and the stale-projects shortcut.
  automatic: boolean;
  // Folders picked in the Files app (the iPhone can't see the disk otherwise).
  folders: boolean;
  // The disk panel: its title, and notes for findings and purgeable space.
  disk: string;
  foundNote: string;
  purgeableNote: string;
  scanning: string;
  lookWhat: string;
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  mac: {
    id: 'mac', device: 'Mac',
    mode: 'macOS / storage',
    scope: 'Mac inteiro · caches, projetos e arquivos para revisão',
    scopeNote: 'Disco local · acesso permitido pelo macOS',
    footer: 'Limpeza via Lixeira · restauração pelo Finder.',
    send: 'Enviar à Lixeira', toTrash: 'para a Lixeira', inTrash: 'na Lixeira', cheer: 'Pra Lixeira!',
    freeSpace: 'Esvazie a Lixeira para liberar espaço.', catFreeSpace: 'Agora é só esvaziar a Lixeira.',
    reveal: 'Mostrar no Finder', opening: 'Abrindo no Finder…', automatic: true, folders: false,
    disk: 'DISCO DO MAC', foundNote: 'Fica livre depois de esvaziar a Lixeira', purgeableNote: 'Caches e cópias que o macOS apaga sozinho quando falta espaço',
    scanning: 'Varrendo caches e node_modules…', lookWhat: 'caches, node_modules e outras tralhas de dev',
  },
  ios: {
    id: 'ios', device: 'iPhone',
    mode: 'iOS / storage',
    scope: 'iPhone · fototeca e pastas do Arquivos',
    scopeNote: 'Só o que o iOS deixa ver · nada de outros apps',
    footer: 'Limpeza via Apagados · recuperável nos apps Fotos e Arquivos.',
    send: 'Enviar para Apagados', toTrash: 'para Apagados', inTrash: 'em Apagados', cheer: 'Pra Apagados!',
    freeSpace: 'Para liberar espaço já, apague de vez em Apagados, no app Fotos ou Arquivos.', catFreeSpace: 'O espaço volta quando Apagados esvaziar.',
    reveal: 'Abrir para conferir', opening: 'Abrindo… Vídeos grandes podem levar alguns segundos.', automatic: false, folders: true,
    disk: 'ARMAZENAMENTO DO IPHONE', foundNote: 'Fica livre quando Apagados esvaziar', purgeableNote: 'Caches e originais do iCloud que o iOS apaga sozinho quando falta espaço',
    scanning: 'Varrendo fotos e vídeos…', lookWhat: 'vídeos grandes, fotos repetidas, capturas de tela velhas e outras tralhas',
  },
};

// The platform the shell reports; Electron reports none, so it is the Mac.
export function currentPlatform(reported: unknown): Platform {
  return reported === 'ios' ? PLATFORMS.ios : PLATFORMS.mac;
}
