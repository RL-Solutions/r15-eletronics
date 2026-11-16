// =====================================================================
//  CONFIGURAÇÃO DA LOJA — edite só este arquivo para personalizar.
// =====================================================================
window.STORE_CONFIG = {
  // Marca ---------------------------------------------------------------
  brandName: "R15 Eletronics",
  brandTagline: "Tabacaria e acessórios",
  brandInitial: "R15",                // texto do ícone do logo (até 3 caracteres)

  // Aviso de idade ------------------------------------------------------
  ageGate: true,                      // pergunta "Você tem 18 anos ou mais?" na entrada

  // Contato -------------------------------------------------------------
  // WhatsApp no formato internacional, só números (55 + DDD + número)
  whatsapp: "5500000000000",
  instagram: "",                      // ex.: "suamarca" (sem @)
  email: "",

  // Promoções -----------------------------------------------------------
  pixDiscount: 0.035,                 // 3,5% de desconto no Pix
  topBarText: "10% off na primeira compra com o cupom BEMVINDO",
  marquee: ["Mês da Black", "Queima de estoque", "Envio no mesmo dia", "Frete para todo o Brasil", "Desconto no Pix", "Só para maiores de 18"],
  countdownTo: "2026-11-27T00:00:00-03:00",   // início da Black Friday

  // Banner principal
  heroKicker: "Novembro é mês da Black",
  heroTitle: ["Pré", "Black"],                // a 2ª palavra fica roxa
  heroDeal: { pre: "Até", value: "25%", post: "off" },
  heroText: "Preço de Black antes da Black em",
  heroTextStrong: "sedas, isqueiros e bags selecionados.",

  // Queima de estoque
  flashKicker: "Só hoje",                     // selo acima do título (deixe "" para esconder)

  lowStockThreshold: 3,              // "Restam X unidades" quando estoque ≤ este valor

  // Supabase ------------------------------------------------------------
  // Supabase Dashboard > Project Settings > API
  // Deixe vazio para rodar com os produtos de demonstração abaixo.
  supabaseUrl: "",
  supabaseAnonKey: "",

  // Frete ---------------------------------------------------------------
  // Calculado pela Edge Function "frete" (supabase/functions/frete).
  // Aparece no carrinho só quando o Supabase acima estiver preenchido.
  freight: true,
  freightFunction: "frete",

  // Pagamento no site (Mercado Pago) -------------------------------------
  // Cole a Public Key (Mercado Pago > Suas integrações > Credenciais).
  // A Public Key pode ficar no site. O Access Token NUNCA: ele vai nos
  // Secrets do Supabase. Vazio = o pedido segue pelo WhatsApp.
  mercadoPagoPublicKey: "",
  paymentFunction: "pagamento",
  maxInstallments: 12,
};

// Produtos de demonstração (usados só enquanto o Supabase não está configurado)
window.DEMO_PRODUCTS = [
  { id: 1,  name: "Seda King Size Slim",            variant: "Livreto com 33 folhas",  category: "Sedas",        price: 7.90,   sale_price: 6.50,   stock: 120, featured: true,  clearance: false, ships_today: true  },
  { id: 2,  name: "Seda Brown King Size",            variant: "Sem branqueamento",      category: "Sedas",        price: 8.90,   sale_price: null,   stock: 85,  featured: true,  clearance: false, ships_today: true  },
  { id: 3,  name: "Piteira de Vidro Reutilizável",   variant: "6 mm",                   category: "Piteiras",     price: 24.90,  sale_price: 19.90,  stock: 18,  featured: true,  clearance: false, ships_today: true  },
  { id: 4,  name: "Bloco de Piteiras de Papel",      variant: "Extra longa",            category: "Piteiras",     price: 6.90,   sale_price: 5.90,   stock: 64,  featured: true,  clearance: false, ships_today: true  },
  { id: 5,  name: "Isqueiro Recarregável",           variant: "Preto fosco",            category: "Isqueiros",    price: 14.90,  sale_price: 12.90,  stock: 40,  featured: true,  clearance: false, ships_today: true  },
  { id: 6,  name: "Isqueiro Maçarico Jet",           variant: "Chama azul",             category: "Isqueiros",    price: 69.90,  sale_price: 54.90,  stock: 5,   featured: true,  clearance: false, ships_today: false },
  { id: 7,  name: "Bag Anti-Odor Média",             variant: "Roxa, com zíper",        category: "Bags",         price: 89.90,  sale_price: 69.90,  stock: 12,  featured: true,  clearance: false, ships_today: true  },
  { id: 8,  name: "Case Rígido com Divisórias",      variant: "Preto",                  category: "Cases",        price: 59.90,  sale_price: 49.90,  stock: 9,   featured: true,  clearance: false, ships_today: true  },
  { id: 9,  name: "Bag Impermeável Pequena",         variant: "Preta",                  category: "Bags",         price: 45.00,  sale_price: 34.90,  stock: 1,   featured: false, clearance: true,  ships_today: true  },
  { id: 10, name: "Dichavador de Metal 4 Partes",    variant: "Grafite, 50 mm",         category: "Dichavadores", price: 79.90,  sale_price: 59.90,  stock: 2,   featured: false, clearance: true,  ships_today: true  },
  { id: 11, name: "Case Porta-Sedas",                variant: "Couro sintético",        category: "Cases",        price: 39.90,  sale_price: 29.90,  stock: 1,   featured: false, clearance: true,  ships_today: true  },
  { id: 12, name: "Piteira de Vidro Colorida",       variant: "8 mm, roxa",             category: "Piteiras",     price: 29.90,  sale_price: 22.90,  stock: 2,   featured: false, clearance: true,  ships_today: true  },
  { id: 13, name: "Bandeja de Metal Média",          variant: "27 × 16 cm",             category: "Acessórios",   price: 34.90,  sale_price: null,   stock: 22,  featured: false, clearance: false, ships_today: true  },
  { id: 14, name: "Cinzeiro de Silicone",            variant: "Roxo",                   category: "Acessórios",   price: 24.90,  sale_price: 19.90,  stock: 15,  featured: false, clearance: false, ships_today: true  },
  { id: 15, name: "Bag Grande com Cadeado",          variant: "Preta",                  category: "Bags",         price: 129.90, sale_price: 109.90, stock: 0,   featured: false, clearance: false, ships_today: true  },
];
