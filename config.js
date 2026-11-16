// =====================================================================
//  CONFIGURAÇÃO DA LOJA — edite só este arquivo para personalizar.
// =====================================================================
window.STORE_CONFIG = {
  // Marca ---------------------------------------------------------------
  brandName: "R15 Eletronics",
  brandTagline: "Eletrônicos e acessórios",
  brandInitial: "R15",                // texto do ícone do logo (até 3 caracteres)

  // Contato -------------------------------------------------------------
  // WhatsApp no formato internacional, só números (55 + DDD + número)
  whatsapp: "5500000000000",
  instagram: "",                      // ex.: "suamarca" (sem @)
  email: "",

  // Promoções -----------------------------------------------------------
  pixDiscount: 0.035,                 // 3,5% de desconto no Pix
  topBarText: "10% off na primeira compra com o cupom BEMVINDO",
  marquee: ["Mês da Black", "Envio no mesmo dia", "Frete para todo o Brasil", "Desconto no Pix", "Queima de estoque"],
  countdownTo: "2026-11-27T00:00:00-03:00",   // início da Black Friday
  heroTitle: ["Pré", "Black"],
  heroDeal: "Até 20% off",
  heroText: "Preço de Black antes da Black em fones, carregadores e acessórios selecionados.",
  lowStockThreshold: 3,               // "Restam X unidades" quando estoque ≤ este valor

  // Supabase ------------------------------------------------------------
  // Supabase Dashboard > Project Settings > API
  // Deixe vazio para rodar com os produtos de demonstração abaixo.
  supabaseUrl: "",
  supabaseAnonKey: "",
};

// Produtos de demonstração (usados só enquanto o Supabase não está configurado)
window.DEMO_PRODUCTS = [
  { id: 1,  name: "Fone Bluetooth Pro ANC",    variant: "Preto",      brand: "Sonik",   category: "Áudio",        price: 249.90, sale_price: 199.90, stock: 14, featured: true,  clearance: false, ships_today: true  },
  { id: 2,  name: "Caixa de Som Boom Mini",     variant: "Azul",       brand: "Sonik",   category: "Áudio",        price: 189.90, sale_price: 159.90, stock: 6,  featured: true,  clearance: false, ships_today: true  },
  { id: 3,  name: "Carregador Turbo 65W GaN",   variant: "USB-C x2",   brand: "Voltera", category: "Carregadores", price: 159.90, sale_price: 129.90, stock: 22, featured: true,  clearance: false, ships_today: true  },
  { id: 4,  name: "Power Bank 20.000mAh",       variant: "Grafite",    brand: "Voltera", category: "Carregadores", price: 199.90, sale_price: 169.90, stock: 9,  featured: true,  clearance: false, ships_today: true  },
  { id: 5,  name: "Smartwatch Fit S3",          variant: "Preto",      brand: "Pulso",   category: "Wearables",    price: 329.90, sale_price: 279.90, stock: 4,  featured: true,  clearance: false, ships_today: false },
  { id: 6,  name: "Cabo USB-C Trançado 2m",     variant: "100W",       brand: "Voltera", category: "Cabos",        price: 49.90,  sale_price: 39.90,  stock: 40, featured: true,  clearance: false, ships_today: true  },
  { id: 7,  name: "Ring Light 10\" com Tripé",  variant: "Branco",     brand: "Lumo",    category: "Acessórios",   price: 139.90, sale_price: null,   stock: 12, featured: true,  clearance: false, ships_today: true  },
  { id: 8,  name: "Teclado Mecânico Compacto",  variant: "Switch Red", brand: "Kraft",   category: "Gamer",        price: 299.90, sale_price: 259.90, stock: 7,  featured: true,  clearance: false, ships_today: false },
  { id: 9,  name: "Fone TWS Air Lite",          variant: "Branco",     brand: "Sonik",   category: "Áudio",        price: 129.90, sale_price: 99.90,  stock: 1,  featured: false, clearance: true,  ships_today: true  },
  { id: 10, name: "Mouse Gamer RGB 12.000 DPI", variant: "Preto",      brand: "Kraft",   category: "Gamer",        price: 149.90, sale_price: 119.90, stock: 2,  featured: false, clearance: true,  ships_today: true  },
  { id: 11, name: "Suporte Veicular Magnético", variant: "MagSafe",    brand: "Lumo",    category: "Acessórios",   price: 89.90,  sale_price: 69.90,  stock: 1,  featured: false, clearance: true,  ships_today: true  },
  { id: 12, name: "Hub USB-C 7 em 1",           variant: "HDMI 4K",    brand: "Voltera", category: "Acessórios",   price: 219.90, sale_price: 179.90, stock: 2,  featured: false, clearance: true,  ships_today: true  },
  { id: 13, name: "Película Hydrogel Premium",  variant: "Universal",  brand: "Lumo",    category: "Acessórios",   price: 39.90,  sale_price: null,   stock: 55, featured: false, clearance: false, ships_today: true  },
  { id: 14, name: "Controle Bluetooth Gamepad", variant: "Preto",      brand: "Kraft",   category: "Gamer",        price: 179.90, sale_price: 149.90, stock: 0,  featured: false, clearance: false, ships_today: true  },
];
