import type { Knex } from 'knex';
import type { Allergen, CategoryIcon, DietaryTag } from '@tavolina/shared';

/**
 * Demo menu for Bar Restaurant Las Vegas (Tirana): 61 items in Albanian with English and Italian
 * translations, realistic lek prices, allergens, variants and the modifier groups from plan §14.
 * Runs after 01_demo_access (which empties the database).
 */

type Tr = [en: string, it: string];

interface ItemSeed {
  sq: string;
  tr: Tr;
  lek: number;
  desc?: [sq: string, en: string, it: string];
  allergens?: Allergen[];
  tags?: DietaryTag[];
  popular?: boolean;
  isNew?: boolean;
  prep?: number;
  variants?: [sq: string, tr: Tr, lek: number][];
  groups?: GroupKey[];
}

interface CategorySeed {
  sq: string;
  tr: Tr;
  icon: CategoryIcon;
  station: 'Kuzhina' | 'Bar';
  hours?: [from: string, to: string];
  desc?: [sq: string, en: string, it: string];
  items: ItemSeed[];
}

type GroupKey = 'milk' | 'sugar' | 'ice' | 'doneness' | 'extras';

const GROUPS: Record<
  GroupKey,
  {
    sq: string;
    tr: Tr;
    min: number;
    max: number;
    required: boolean;
    options: [string, Tr, number][];
  }
> = {
  milk: {
    sq: 'Qumështi',
    tr: ['Milk', 'Latte'],
    min: 0,
    max: 1,
    required: false,
    options: [
      ['I plotë', ['Whole', 'Intero'], 0],
      ['Tërshërë', ['Oat', 'Avena'], 50],
      ['Bajame', ['Almond', 'Mandorla'], 50],
      ['Pa laktozë', ['Lactose-free', 'Senza lattosio'], 30],
    ],
  },
  sugar: {
    sq: 'Sheqeri',
    tr: ['Sugar', 'Zucchero'],
    min: 0,
    max: 1,
    required: false,
    options: [
      ['Pa sheqer', ['No sugar', 'Senza zucchero'], 0],
      ['Pak sheqer', ['Little sugar', 'Poco zucchero'], 0],
      ['Normal', ['Normal', 'Normale'], 0],
      ['Shumë sheqer', ['Extra sugar', 'Molto zucchero'], 0],
    ],
  },
  ice: {
    sq: 'Akulli',
    tr: ['Ice', 'Ghiaccio'],
    min: 0,
    max: 1,
    required: false,
    options: [
      ['Me akull', ['With ice', 'Con ghiaccio'], 0],
      ['Pak akull', ['Little ice', 'Poco ghiaccio'], 0],
      ['Pa akull', ['No ice', 'Senza ghiaccio'], 0],
    ],
  },
  doneness: {
    sq: 'Pjekja e mishit',
    tr: ['Doneness', 'Cottura'],
    min: 1,
    max: 1,
    required: true,
    options: [
      ['Gjysmë e pjekur', ['Rare', 'Al sangue'], 0],
      ['Pak e pjekur', ['Medium rare', 'Media al sangue'], 0],
      ['Mesatare', ['Medium', 'Media'], 0],
      ['E pjekur mirë', ['Well done', 'Ben cotta'], 0],
    ],
  },
  extras: {
    sq: 'Shtesa për kafen',
    tr: ['Coffee extras', 'Extra per il caffè'],
    min: 0,
    max: 3,
    required: false,
    options: [
      ['Shot ekstra', ['Extra shot', 'Shot extra'], 60],
      ['Shurup vanilje', ['Vanilla syrup', 'Sciroppo alla vaniglia'], 50],
      ['Krem i rrahur', ['Whipped cream', 'Panna montata'], 50],
    ],
  },
};

const COFFEE: GroupKey[] = ['sugar', 'extras'];
const MILK_COFFEE: GroupKey[] = ['milk', 'sugar', 'extras'];

const MENU: CategorySeed[] = [
  {
    sq: 'Kafe',
    tr: ['Coffee', 'Caffè'],
    icon: 'coffee',
    station: 'Bar',
    items: [
      {
        sq: 'Espresso',
        tr: ['Espresso', 'Espresso'],
        lek: 100,
        popular: true,
        prep: 2,
        groups: COFFEE,
      },
      {
        sq: 'Makiato',
        tr: ['Macchiato', 'Caffè macchiato'],
        lek: 120,
        allergens: ['milk'],
        popular: true,
        prep: 2,
        groups: MILK_COFFEE,
      },
      {
        sq: 'Kapuçino',
        tr: ['Cappuccino', 'Cappuccino'],
        lek: 180,
        allergens: ['milk'],
        prep: 3,
        groups: MILK_COFFEE,
      },
      {
        sq: 'Kafe amerikane',
        tr: ['Americano', 'Caffè americano'],
        lek: 150,
        prep: 2,
        groups: COFFEE,
      },
      {
        sq: 'Kafe turke',
        tr: ['Turkish coffee', 'Caffè turco'],
        lek: 100,
        prep: 5,
        groups: ['sugar'],
        desc: [
          'E zier në xhezve, me llum, siç pihet në Shqipëri.',
          'Brewed in a cezve with the grounds, the way it is drunk in Albania.',
          'Preparato nella cezve con i fondi, come si beve in Albania.',
        ],
      },
      {
        sq: 'Latte',
        tr: ['Caffè latte', 'Caffellatte'],
        lek: 220,
        allergens: ['milk'],
        prep: 3,
        groups: MILK_COFFEE,
      },
      {
        sq: 'Freddo espresso',
        tr: ['Freddo espresso', 'Freddo espresso'],
        lek: 200,
        popular: true,
        prep: 3,
        groups: ['sugar', 'ice', 'extras'],
      },
      {
        sq: 'Freddo kapuçino',
        tr: ['Freddo cappuccino', 'Freddo cappuccino'],
        lek: 250,
        allergens: ['milk'],
        isNew: true,
        prep: 3,
        groups: ['milk', 'sugar', 'ice', 'extras'],
      },
      {
        sq: 'Çokollatë e ngrohtë',
        tr: ['Hot chocolate', 'Cioccolata calda'],
        lek: 250,
        allergens: ['milk', 'soybeans'],
        tags: ['vegetarian'],
        prep: 4,
        groups: ['milk'],
      },
    ],
  },
  {
    sq: 'Çajra',
    tr: ['Tea', 'Tè'],
    icon: 'coffee',
    station: 'Bar',
    items: [
      {
        sq: 'Çaj mali',
        tr: ['Albanian mountain tea', 'Tè di montagna albanese'],
        lek: 150,
        tags: ['vegan', 'gluten_free'],
        popular: true,
        prep: 4,
        groups: ['sugar'],
        desc: [
          'Çaj i egër nga malet shqiptare, me mjaltë sipas dëshirës.',
          'Wild herbal tea from the Albanian mountains, with honey if you like.',
          'Tisana selvatica delle montagne albanesi, con miele a piacere.',
        ],
      },
      {
        sq: 'Çaj jeshil',
        tr: ['Green tea', 'Tè verde'],
        lek: 150,
        tags: ['vegan', 'gluten_free'],
        prep: 4,
        groups: ['sugar'],
      },
      {
        sq: 'Çaj kamomili',
        tr: ['Chamomile tea', 'Camomilla'],
        lek: 150,
        tags: ['vegan', 'gluten_free'],
        prep: 4,
        groups: ['sugar'],
      },
      {
        sq: 'Çaj me xhenxhefil dhe limon',
        tr: ['Ginger and lemon tea', 'Tè zenzero e limone'],
        lek: 200,
        tags: ['vegan', 'gluten_free'],
        prep: 5,
        groups: ['sugar'],
      },
    ],
  },
  {
    sq: 'Pije freskuese',
    tr: ['Soft drinks', 'Bibite'],
    icon: 'cup-soda',
    station: 'Bar',
    items: [
      {
        sq: 'Lëng portokalli i freskët',
        tr: ['Fresh orange juice', "Spremuta d'arancia"],
        lek: 250,
        tags: ['vegan', 'gluten_free'],
        prep: 4,
        groups: ['ice'],
        variants: [
          ['Gotë e vogël', ['Small glass', 'Bicchiere piccolo'], 250],
          ['Gotë e madhe', ['Large glass', 'Bicchiere grande'], 350],
        ],
      },
      {
        sq: 'Lëng shege i freskët',
        tr: ['Fresh pomegranate juice', 'Succo di melograno fresco'],
        lek: 350,
        tags: ['vegan', 'gluten_free'],
        isNew: true,
        prep: 5,
        groups: ['ice'],
      },
      {
        sq: 'Limonadë shtëpie',
        tr: ['Homemade lemonade', 'Limonata della casa'],
        lek: 250,
        tags: ['vegan', 'gluten_free'],
        prep: 3,
        groups: ['ice', 'sugar'],
      },
      {
        sq: 'Coca-Cola 0.33 l',
        tr: ['Coca-Cola 0.33 l', 'Coca-Cola 0,33 l'],
        lek: 200,
        tags: ['vegan', 'gluten_free'],
        prep: 1,
        groups: ['ice'],
      },
      {
        sq: 'Ujë Glina',
        tr: ['Glina still water', 'Acqua naturale Glina'],
        lek: 100,
        tags: ['vegan', 'gluten_free'],
        prep: 1,
        variants: [
          ['0.5 l', ['0.5 l', '0,5 l'], 100],
          ['1.5 l', ['1.5 l', '1,5 l'], 200],
        ],
      },
      {
        sq: 'Ujë me gaz',
        tr: ['Sparkling water', 'Acqua frizzante'],
        lek: 150,
        tags: ['vegan', 'gluten_free'],
        prep: 1,
      },
      {
        sq: 'Dhallë',
        tr: ['Dhallë (salted yogurt drink)', 'Dhallë (bevanda allo yogurt)'],
        lek: 150,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 1,
      },
    ],
  },
  {
    sq: 'Birra',
    tr: ['Beer', 'Birre'],
    icon: 'beer',
    station: 'Bar',
    desc: [
      'Happy hour 17:00–19:00, e hënë–e premte: -20%.',
      'Happy hour 17:00–19:00, Monday–Friday: 20% off.',
      'Happy hour 17:00–19:00, lunedì–venerdì: -20%.',
    ],
    items: [
      {
        sq: 'Birra Korça 0.5 l',
        tr: ['Korça beer 0.5 l', 'Birra Korça 0,5 l'],
        lek: 250,
        allergens: ['gluten'],
        popular: true,
        prep: 1,
      },
      {
        sq: 'Birra Tirana 0.33 l',
        tr: ['Tirana beer 0.33 l', 'Birra Tirana 0,33 l'],
        lek: 250,
        allergens: ['gluten'],
        prep: 1,
      },
      {
        sq: 'Birra Peja 0.5 l',
        tr: ['Peja beer 0.5 l', 'Birra Peja 0,5 l'],
        lek: 300,
        allergens: ['gluten'],
        prep: 1,
      },
      {
        sq: 'Heineken 0.33 l',
        tr: ['Heineken 0.33 l', 'Heineken 0,33 l'],
        lek: 350,
        allergens: ['gluten'],
        prep: 1,
      },
    ],
  },
  {
    sq: 'Verë dhe raki',
    tr: ['Wine and raki', 'Vino e raki'],
    icon: 'wine',
    station: 'Bar',
    items: [
      {
        sq: 'Raki rrushi',
        tr: ['Grape raki', "Raki d'uva"],
        lek: 200,
        popular: true,
        prep: 1,
        tags: ['vegan', 'gluten_free'],
        variants: [
          ['50 ml', ['50 ml', '50 ml'], 200],
          ['100 ml', ['100 ml', '100 ml'], 350],
        ],
      },
      {
        sq: 'Raki mani',
        tr: ['Mulberry raki', 'Raki di gelso'],
        lek: 250,
        tags: ['vegan', 'gluten_free'],
        prep: 1,
      },
      {
        sq: 'Verë e kuqe Kallmet',
        tr: ['Kallmet red wine', 'Vino rosso Kallmet'],
        lek: 400,
        allergens: ['sulphites'],
        prep: 1,
        desc: [
          'Verë e kuqe nga rrushi autokton Kallmet i Zadrimës.',
          'Red wine from Kallmet, a native grape of the Zadrima plain.',
          'Vino rosso da Kallmet, vitigno autoctono della piana di Zadrima.',
        ],
        variants: [
          ['Gotë', ['Glass', 'Calice'], 400],
          ['Shishe 0.75 l', ['Bottle 0.75 l', 'Bottiglia 0,75 l'], 2200],
        ],
      },
      {
        sq: 'Verë e bardhë Shesh i bardhë',
        tr: ['Shesh i bardhë white wine', 'Vino bianco Shesh i bardhë'],
        lek: 400,
        allergens: ['sulphites'],
        prep: 1,
        variants: [
          ['Gotë', ['Glass', 'Calice'], 400],
          ['Shishe 0.75 l', ['Bottle 0.75 l', 'Bottiglia 0,75 l'], 2000],
        ],
      },
      {
        sq: 'Konjak Skënderbeu',
        tr: ['Skënderbeu brandy', 'Brandy Skënderbeu'],
        lek: 300,
        prep: 1,
      },
    ],
  },
  {
    sq: 'Mëngjes',
    tr: ['Breakfast', 'Colazione'],
    icon: 'croissant',
    station: 'Kuzhina',
    hours: ['07:00', '11:30'],
    desc: ['Shërbehet 07:00–11:30.', 'Served 07:00–11:30.', 'Servita dalle 07:00 alle 11:30.'],
    items: [
      {
        sq: 'Byrek me spinaq',
        tr: ['Spinach byrek', 'Byrek agli spinaci'],
        lek: 150,
        allergens: ['gluten', 'milk', 'eggs'],
        tags: ['vegetarian'],
        popular: true,
        prep: 3,
        desc: [
          'Petë e hollë shtëpie me spinaq dhe gjizë.',
          'Thin homemade filo pastry with spinach and gjizë cheese.',
          'Pasta fillo fatta in casa con spinaci e formaggio gjizë.',
        ],
      },
      {
        sq: 'Byrek me gjizë',
        tr: ['Cheese byrek', 'Byrek al formaggio'],
        lek: 150,
        allergens: ['gluten', 'milk', 'eggs'],
        tags: ['vegetarian'],
        prep: 3,
      },
      {
        sq: 'Petulla me mjaltë',
        tr: ['Petulla with honey', 'Petulla al miele'],
        lek: 300,
        allergens: ['gluten'],
        tags: ['vegetarian'],
        prep: 8,
        desc: [
          'Petulla të fryra, të skuqura, me mjaltë mali.',
          'Light fried dough puffs with mountain honey.',
          'Frittelle soffici con miele di montagna.',
        ],
      },
      {
        sq: 'Petulla me djathë',
        tr: ['Petulla with white cheese', 'Petulla con formaggio bianco'],
        lek: 300,
        allergens: ['gluten', 'milk'],
        tags: ['vegetarian'],
        prep: 8,
      },
      {
        sq: 'Omëletë me djathë',
        tr: ['Cheese omelette', 'Omelette al formaggio'],
        lek: 350,
        allergens: ['eggs', 'milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 8,
      },
      {
        sq: 'Vezë me sallam',
        tr: ['Eggs with salami', 'Uova con salame'],
        lek: 350,
        allergens: ['eggs'],
        prep: 8,
      },
      {
        sq: 'Tost me djathë dhe proshutë',
        tr: ['Ham and cheese toast', 'Toast prosciutto e formaggio'],
        lek: 300,
        allergens: ['gluten', 'milk'],
        prep: 6,
      },
    ],
  },
  {
    sq: 'Sallata',
    tr: ['Salads', 'Insalate'],
    icon: 'salad',
    station: 'Kuzhina',
    items: [
      {
        sq: 'Sallatë shqiptare',
        tr: ['Albanian salad', 'Insalata albanese'],
        lek: 350,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        popular: true,
        prep: 6,
        desc: [
          'Domate, kastravec, qepë, speca, ullinj dhe djathë i bardhë.',
          'Tomato, cucumber, onion, peppers, olives and white cheese.',
          'Pomodoro, cetriolo, cipolla, peperoni, olive e formaggio bianco.',
        ],
      },
      {
        sq: 'Sallatë Cezar me pulë',
        tr: ['Chicken Caesar salad', 'Insalata Caesar con pollo'],
        lek: 650,
        allergens: ['gluten', 'eggs', 'milk', 'fish', 'mustard'],
        prep: 10,
      },
      {
        sq: 'Sallatë greke',
        tr: ['Greek salad', 'Insalata greca'],
        lek: 500,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 6,
      },
      {
        sq: 'Sallatë jeshile',
        tr: ['Green salad', 'Insalata verde'],
        lek: 300,
        tags: ['vegan', 'gluten_free'],
        prep: 5,
      },
    ],
  },
  {
    sq: 'Antipasta',
    tr: ['Starters', 'Antipasti'],
    icon: 'utensils',
    station: 'Kuzhina',
    items: [
      {
        sq: 'Speca me gjizë',
        tr: ['Peppers with gjizë', 'Peperoni con gjizë'],
        lek: 450,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 10,
        desc: [
          'Speca të pjekur të mbushur me gjizë dhe hudhër.',
          'Roasted peppers stuffed with gjizë cheese and garlic.',
          'Peperoni arrostiti ripieni di formaggio gjizë e aglio.',
        ],
      },
      {
        sq: 'Tarator',
        tr: ['Tarator (yogurt, cucumber and garlic)', 'Tarator (yogurt, cetriolo e aglio)'],
        lek: 300,
        allergens: ['milk', 'nuts'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 3,
      },
      {
        sq: 'Pjatë djathërash shqiptare',
        tr: ['Albanian cheese platter', 'Tagliere di formaggi albanesi'],
        lek: 700,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 6,
      },
      {
        sq: 'Ullinj të marinuar',
        tr: ['Marinated olives', 'Olive marinate'],
        lek: 250,
        tags: ['vegan', 'gluten_free'],
        prep: 2,
      },
    ],
  },
  {
    sq: 'Pjata kryesore',
    tr: ['Main courses', 'Secondi'],
    icon: 'beef',
    station: 'Kuzhina',
    items: [
      {
        sq: 'Tavë kosi',
        tr: ['Tavë kosi (baked lamb with yogurt)', 'Tavë kosi (agnello al forno con yogurt)'],
        lek: 850,
        allergens: ['milk', 'eggs', 'gluten'],
        popular: true,
        prep: 20,
        desc: [
          'Mish qengji i pjekur në furrë me kos dhe vezë, receta e Elbasanit.',
          'Lamb baked with yogurt and eggs, the classic recipe from Elbasan.',
          'Agnello al forno con yogurt e uova, la ricetta classica di Elbasan.',
        ],
      },
      {
        sq: 'Fërgesë Tirane',
        tr: ['Fërgesë, Tirana style', 'Fërgesë alla tiranese'],
        lek: 700,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 15,
        desc: [
          'Speca, domate dhe gjizë të pjekura në tavë balte.',
          'Peppers, tomatoes and gjizë cheese baked in a clay dish.',
          'Peperoni, pomodori e formaggio gjizë cotti in un tegame di coccio.',
        ],
      },
      {
        sq: 'Qofte të fërguara',
        tr: ['Fried meatballs', 'Polpette fritte'],
        lek: 650,
        allergens: ['gluten', 'eggs'],
        popular: true,
        prep: 15,
      },
      {
        sq: 'Pulë në skarë',
        tr: ['Grilled chicken', 'Pollo alla griglia'],
        lek: 750,
        tags: ['gluten_free'],
        prep: 20,
      },
      {
        sq: 'Levrek në skarë',
        tr: ['Grilled sea bass', 'Branzino alla griglia'],
        lek: 1400,
        allergens: ['fish'],
        tags: ['gluten_free'],
        prep: 25,
        desc: [
          'Levrek i freskët në skarë me perime dhe vaj ulliri.',
          'Fresh sea bass from the grill with vegetables and olive oil.',
          "Branzino fresco alla griglia con verdure e olio d'oliva.",
        ],
      },
      {
        sq: 'Biftek viçi',
        tr: ['Beef steak', 'Bistecca di manzo'],
        lek: 1600,
        tags: ['gluten_free'],
        isNew: true,
        prep: 20,
        groups: ['doneness'],
      },
      {
        sq: 'Paidhaqe qengji',
        tr: ['Lamb chops', "Costolette d'agnello"],
        lek: 1500,
        tags: ['gluten_free'],
        prep: 20,
      },
      {
        sq: 'Tavë dheu',
        tr: ['Tavë dheu (clay pot with liver)', 'Tavë dheu (coccio con fegato)'],
        lek: 900,
        allergens: ['milk'],
        tags: ['spicy'],
        prep: 20,
      },
      {
        sq: 'Japrak',
        tr: ['Stuffed vine leaves', 'Involtini di foglie di vite'],
        lek: 650,
        allergens: ['milk'],
        prep: 10,
      },
    ],
  },
  {
    sq: 'Pasta dhe rizoto',
    tr: ['Pasta and risotto', 'Pasta e risotto'],
    icon: 'soup',
    station: 'Kuzhina',
    items: [
      {
        sq: 'Spageti bolonjeze',
        tr: ['Spaghetti bolognese', 'Spaghetti alla bolognese'],
        lek: 650,
        allergens: ['gluten', 'celery'],
        prep: 15,
      },
      {
        sq: 'Pene me pulë dhe kërpudha',
        tr: ['Penne with chicken and mushrooms', 'Penne con pollo e funghi'],
        lek: 700,
        allergens: ['gluten', 'milk'],
        prep: 15,
      },
      {
        sq: 'Rizoto me fruta deti',
        tr: ['Seafood risotto', 'Risotto ai frutti di mare'],
        lek: 1100,
        allergens: ['crustaceans', 'molluscs', 'fish', 'milk', 'celery'],
        tags: ['gluten_free'],
        prep: 20,
      },
    ],
  },
  {
    sq: 'Ëmbëlsira',
    tr: ['Desserts', 'Dolci'],
    icon: 'cake',
    station: 'Kuzhina',
    items: [
      {
        sq: 'Trileçe',
        tr: ['Trileçe (three-milk cake)', 'Trileçe (torta ai tre latti)'],
        lek: 350,
        allergens: ['gluten', 'eggs', 'milk'],
        tags: ['vegetarian'],
        popular: true,
        prep: 2,
      },
      {
        sq: 'Bakllava',
        tr: ['Baklava', 'Baklava'],
        lek: 300,
        allergens: ['gluten', 'nuts'],
        tags: ['vegetarian'],
        prep: 2,
      },
      {
        sq: 'Sultjash',
        tr: ['Rice pudding', 'Budino di riso'],
        lek: 300,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 2,
      },
      {
        sq: 'Kadaif',
        tr: ['Kadaif', 'Kadaif'],
        lek: 300,
        allergens: ['gluten', 'nuts', 'milk'],
        tags: ['vegetarian'],
        prep: 2,
      },
      {
        sq: 'Akullore',
        tr: ['Ice cream', 'Gelato'],
        lek: 250,
        allergens: ['milk'],
        tags: ['vegetarian', 'gluten_free'],
        prep: 2,
        variants: [
          ['2 topa', ['2 scoops', '2 palline'], 250],
          ['3 topa', ['3 scoops', '3 palline'], 350],
        ],
      },
    ],
  },
];

const L = (lek: number) => lek * 100;

async function translate(
  knex: Knex,
  type: string,
  id: number,
  values: { en?: [string, string?]; it?: [string, string?] },
) {
  const rows: Record<string, unknown>[] = [];
  for (const lang of ['en', 'it'] as const) {
    const [name, description] = values[lang] ?? [];
    if (name) rows.push({ entity_type: type, entity_id: id, field: 'name', lang, value: name });
    if (description)
      rows.push({
        entity_type: type,
        entity_id: id,
        field: 'description',
        lang,
        value: description,
      });
  }
  if (rows.length) await knex('translations').insert(rows);
}

export async function seed(knex: Knex): Promise<void> {
  const location = await knex('locations').first<{ id: number }>('id');
  if (!location) throw new Error('Run 01_demo_access first');
  const locationId = location.id;

  const stationId: Record<string, number> = {};
  for (const [sort, [name, type]] of (
    [
      ['Kuzhina', 'kitchen'],
      ['Bar', 'bar'],
    ] as const
  ).entries()) {
    const [id] = await knex('stations').insert({ location_id: locationId, name, type, sort });
    stationId[name] = id!;
  }

  const [vat20] = await knex('tax_rates').insert({
    location_id: locationId,
    name: 'TVSH 20%',
    rate_bp: 2000,
    is_default: true,
  });
  await knex('tax_rates').insert([
    { location_id: locationId, name: 'TVSH 6%', rate_bp: 600, is_default: false },
    { location_id: locationId, name: 'Pa TVSH', rate_bp: 0, is_default: false },
  ]);

  const groupId = {} as Record<GroupKey, number>;
  for (const [sort, [key, g]] of (
    Object.entries(GROUPS) as [GroupKey, (typeof GROUPS)[GroupKey]][]
  ).entries()) {
    const [id] = await knex('modifier_groups').insert({
      location_id: locationId,
      name: g.sq,
      min_select: g.min,
      max_select: g.max,
      required: g.required,
      sort,
    });
    groupId[key] = id!;
    await translate(knex, 'modifier_group', id!, { en: [g.tr[0]], it: [g.tr[1]] });
    for (const [optionSort, [name, tr, lek]] of g.options.entries()) {
      const [modifierId] = await knex('modifiers').insert({
        group_id: id,
        name,
        price_delta_minor: L(lek),
        sort: optionSort,
      });
      await translate(knex, 'modifier', modifierId!, { en: [tr[0]], it: [tr[1]] });
    }
  }

  let beerCategoryId = 0;
  for (const [categorySort, category] of MENU.entries()) {
    const [categoryId] = await knex('menu_categories').insert({
      location_id: locationId,
      name: category.sq,
      description: category.desc?.[0] ?? '',
      icon: category.icon,
      available_from: category.hours?.[0] ?? null,
      available_to: category.hours?.[1] ?? null,
      sort: categorySort,
    });
    if (category.sq === 'Birra') beerCategoryId = categoryId!;
    await translate(knex, 'category', categoryId!, {
      en: [category.tr[0], category.desc?.[1]],
      it: [category.tr[1], category.desc?.[2]],
    });

    for (const [itemSort, item] of category.items.entries()) {
      const [itemId] = await knex('menu_items').insert({
        location_id: locationId,
        category_id: categoryId,
        station_id: stationId[category.station],
        tax_rate_id: vat20,
        name: item.sq,
        description: item.desc?.[0] ?? '',
        price_minor: L(item.lek),
        prep_minutes: item.prep ?? null,
        is_popular: item.popular ?? false,
        is_new: item.isNew ?? false,
        sort: itemSort,
      });
      await translate(knex, 'item', itemId!, {
        en: [item.tr[0], item.desc?.[1]],
        it: [item.tr[1], item.desc?.[2]],
      });
      if (item.allergens?.length) {
        await knex('menu_item_allergens').insert(
          item.allergens.map((a) => ({ item_id: itemId, allergen_key: a })),
        );
      }
      if (item.tags?.length) {
        await knex('menu_item_tags').insert(
          item.tags.map((t) => ({ item_id: itemId, tag_key: t })),
        );
      }
      if (item.groups?.length) {
        await knex('menu_item_modifier_groups').insert(
          item.groups.map((g, sort) => ({ item_id: itemId, group_id: groupId[g], sort })),
        );
      }
      for (const [variantSort, [name, tr, lek]] of (item.variants ?? []).entries()) {
        const [variantId] = await knex('menu_item_variants').insert({
          item_id: itemId,
          name,
          price_minor: L(lek),
          sort: variantSort,
        });
        await translate(knex, 'variant', variantId!, { en: [tr[0]], it: [tr[1]] });
      }
    }
  }

  // Weekday happy hour on beer, 17:00–19:00 Tirana time, 20% off.
  await knex('price_rules').insert({
    location_id: locationId,
    name: 'Happy hour birra',
    scope: 'category',
    scope_id: beerCategoryId,
    type: 'percent',
    value: 2000,
    weekday_mask: 0b0011111,
    time_from: '17:00',
    time_to: '19:00',
  });
}
