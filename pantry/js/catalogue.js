// Common household goods in Singapore supermarkets (FairPrice, Sheng Siong, Giant, Cold Storage), to pick from when
// adding an item. Each line: name | brand | usual size | category | where it's kept | keeps N days after opening.
// "Keeps after opening" is a rough guide only (the label wins); blank means the printed date is what matters.
// Brands and sizes are typical shelf examples, not prices or live stock: the app links to the shops' own search.

export const CATEGORIES = [
  'Sauces & condiments', 'Rice, noodles & grains', 'Canned & jarred', 'Cooking & baking', 'Breakfast & spreads',
  'Drinks', 'Dairy & eggs', 'Bread & bakery', 'Fresh produce', 'Meat & seafood', 'Frozen', 'Snacks', 'Baby',
  'Laundry & cleaning', 'Kitchen & paper', 'Toiletries', 'Medicine & first aid', 'Pet', 'Leftovers', 'Other',
];
export const LOCATIONS = ['Kitchen cabinet', 'Fridge', 'Freezer', 'Store room', 'Bathroom', 'Laundry', 'Medicine box', 'Other'];

const RAW = `
Light soy sauce|Kikkoman|500 ml|Sauces & condiments|Kitchen cabinet|90
Naturally brewed soy sauce|Kikkoman|1 L|Sauces & condiments|Kitchen cabinet|90
Superior light soy sauce|Lee Kum Kee|500 ml|Sauces & condiments|Kitchen cabinet|180
Premium light soy sauce|Tai Hua|640 ml|Sauces & condiments|Kitchen cabinet|180
Dark soy sauce|Tai Hua|640 ml|Sauces & condiments|Kitchen cabinet|365
Superior dark soy sauce|Pearl River Bridge|500 ml|Sauces & condiments|Kitchen cabinet|365
Thick dark soy sauce|Healthy Boy|700 ml|Sauces & condiments|Kitchen cabinet|365
Premium oyster sauce|Lee Kum Kee|510 g|Sauces & condiments|Fridge|90
Oyster sauce|Maggi|500 g|Sauces & condiments|Fridge|90
Fish sauce|Squid Brand|700 ml|Sauces & condiments|Kitchen cabinet|365
Pure sesame oil|Lee Kum Kee|207 ml|Sauces & condiments|Kitchen cabinet|180
Sesame oil|Chee Seng|320 ml|Sauces & condiments|Kitchen cabinet|180
Hoisin sauce|Lee Kum Kee|397 g|Sauces & condiments|Fridge|180
Chilli bean sauce|Lee Kum Kee|368 g|Sauces & condiments|Fridge|180
Black vinegar|Chinkiang|550 ml|Sauces & condiments|Kitchen cabinet|365
Shaoxing cooking wine|Pagoda|640 ml|Sauces & condiments|Kitchen cabinet|365
Hua tiao wine|Kwong Woh Hing|640 ml|Sauces & condiments|Kitchen cabinet|365
Kecap manis sweet soy sauce|ABC|600 ml|Sauces & condiments|Kitchen cabinet|180
Tomato ketchup|Heinz|500 g|Sauces & condiments|Fridge|180
Chilli sauce|Maggi|500 g|Sauces & condiments|Fridge|180
Chilli sauce|Lingham's|280 ml|Sauces & condiments|Fridge|180
Sriracha chilli sauce|Flying Goose|455 ml|Sauces & condiments|Fridge|180
Mayonnaise|Kewpie|300 g|Sauces & condiments|Fridge|30
Mayonnaise|Best Foods|430 ml|Sauces & condiments|Fridge|60
Seasoning sauce|Maggi|200 ml|Sauces & condiments|Kitchen cabinet|365
Chicken stock powder|Knorr|1 kg|Sauces & condiments|Kitchen cabinet|180
Chicken seasoning powder|Maggi|1 kg|Sauces & condiments|Kitchen cabinet|180
Sambal belacan|Tean's Gourmet|200 g|Sauces & condiments|Fridge|60
Belacan shrimp paste|Hai Boey|250 g|Sauces & condiments|Fridge|180
Laksa paste|Prima Taste|185 g|Sauces & condiments|Fridge|30
Chicken rice paste|Prima Taste|85 g|Sauces & condiments|Kitchen cabinet|
Curry powder (meat)|Baba's|250 g|Cooking & baking|Kitchen cabinet|180
Curry powder (fish)|Baba's|250 g|Cooking & baking|Kitchen cabinet|180
Salt|FairPrice|500 g|Cooking & baking|Kitchen cabinet|
Fine sugar|SIS|2 kg|Cooking & baking|Kitchen cabinet|
Brown sugar|SIS|1 kg|Cooking & baking|Kitchen cabinet|
Rock sugar|FairPrice|500 g|Cooking & baking|Kitchen cabinet|
White pepper powder|Ground pepper (generic)|100 g|Cooking & baking|Kitchen cabinet|365
Black pepper|McCormick|50 g|Cooking & baking|Kitchen cabinet|365
Corn flour|Bake King|400 g|Cooking & baking|Kitchen cabinet|180
Plain flour|Prima|1 kg|Cooking & baking|Kitchen cabinet|180
Self-raising flour|Prima|1 kg|Cooking & baking|Kitchen cabinet|180
Baking powder|Bake King|100 g|Cooking & baking|Kitchen cabinet|180
Cooking oil (blended)|Knife|2 L|Cooking & baking|Kitchen cabinet|180
Canola oil|Naturel|2 L|Cooking & baking|Kitchen cabinet|180
Olive oil|Naturel|1 L|Cooking & baking|Kitchen cabinet|180
Peanut oil|Lion & Globe|1 L|Cooking & baking|Kitchen cabinet|180
Coconut cream|Kara|200 ml|Cooking & baking|Kitchen cabinet|3
Evaporated milk|F&N|390 g|Cooking & baking|Kitchen cabinet|5
Sweetened condensed milk|F&N|392 g|Cooking & baking|Kitchen cabinet|14
Dried shiitake mushrooms|FairPrice|100 g|Cooking & baking|Kitchen cabinet|180
Dried anchovies (ikan bilis)|FairPrice|200 g|Cooking & baking|Fridge|90
Dried shrimp|FairPrice|100 g|Cooking & baking|Fridge|90
Thai hom mali rice|Royal Umbrella|5 kg|Rice, noodles & grains|Kitchen cabinet|
Fragrant rice|Golden Phoenix|5 kg|Rice, noodles & grains|Kitchen cabinet|
Thai fragrant rice|SongHe|5 kg|Rice, noodles & grains|Kitchen cabinet|
Brown rice|FairPrice|2 kg|Rice, noodles & grains|Kitchen cabinet|
Japanese rice|Hitomebore|2 kg|Rice, noodles & grains|Kitchen cabinet|
Rolled oats|Quaker|800 g|Rice, noodles & grains|Kitchen cabinet|90
Instant oats|Quaker|800 g|Rice, noodles & grains|Kitchen cabinet|90
Mee goreng instant noodles (5 pack)|Indomie|5 x 80 g|Rice, noodles & grains|Kitchen cabinet|
Curry instant noodles (5 pack)|Maggi|5 x 79 g|Rice, noodles & grains|Kitchen cabinet|
Chicken instant noodles (5 pack)|Koka|5 x 85 g|Rice, noodles & grains|Kitchen cabinet|
Cup noodles|Nissin|75 g|Rice, noodles & grains|Kitchen cabinet|
Mee sua|FairPrice|400 g|Rice, noodles & grains|Kitchen cabinet|
Bee hoon (rice vermicelli)|Chilli Brand|400 g|Rice, noodles & grains|Kitchen cabinet|
Spaghetti|San Remo|500 g|Rice, noodles & grains|Kitchen cabinet|
Macaroni|San Remo|500 g|Rice, noodles & grains|Kitchen cabinet|
Sardines in tomato sauce|Ayam Brand|155 g|Canned & jarred|Kitchen cabinet|2
Tuna chunks in water|Ayam Brand|150 g|Canned & jarred|Kitchen cabinet|2
Baked beans|Heinz|415 g|Canned & jarred|Kitchen cabinet|3
Luncheon meat|Ma Ling|340 g|Canned & jarred|Kitchen cabinet|3
Stewed pork chops|Narcissus|256 g|Canned & jarred|Kitchen cabinet|2
Fried dace with black beans|Eagle Coin|184 g|Canned & jarred|Kitchen cabinet|3
Cream of mushroom soup|Campbell's|420 g|Canned & jarred|Kitchen cabinet|3
Sweet corn kernels|Hosen|425 g|Canned & jarred|Kitchen cabinet|3
Lychee in syrup|Hosen|565 g|Canned & jarred|Kitchen cabinet|3
Pickled lettuce|Narcissus|182 g|Canned & jarred|Kitchen cabinet|3
Kaya|Glory|250 g|Breakfast & spreads|Fridge|14
Peanut butter|Skippy|340 g|Breakfast & spreads|Kitchen cabinet|90
Strawberry jam|Smucker's|340 g|Breakfast & spreads|Fridge|90
Chocolate hazelnut spread|Nutella|350 g|Breakfast & spreads|Kitchen cabinet|90
Honey|Capilano|500 g|Breakfast & spreads|Kitchen cabinet|
Cornflakes|Kellogg's|500 g|Breakfast & spreads|Kitchen cabinet|60
Koko Krunch|Nestlé|330 g|Breakfast & spreads|Kitchen cabinet|60
Butter (salted)|SCS|250 g|Dairy & eggs|Fridge|30
Margarine|Planta|480 g|Dairy & eggs|Fridge|60
Cheese slices|Kraft|250 g|Dairy & eggs|Fridge|14
Fresh milk|Meiji|2 L|Dairy & eggs|Fridge|5
Fresh milk|Magnolia|1 L|Dairy & eggs|Fridge|5
Fresh milk|Farmhouse|2 L|Dairy & eggs|Fridge|5
UHT full cream milk|Dutch Lady|1 L|Dairy & eggs|Kitchen cabinet|4
Low fat UHT milk|Marigold|1 L|Dairy & eggs|Kitchen cabinet|4
Yoghurt|Meiji|130 g x 4|Dairy & eggs|Fridge|
Cultured milk drink|Yakult|5 x 100 ml|Dairy & eggs|Fridge|
Eggs (10)|Pasar|10 eggs|Dairy & eggs|Fridge|
Fresh eggs (10)|Seng Choon|10 eggs|Dairy & eggs|Fridge|
Silken tofu|Unicurd|300 g|Dairy & eggs|Fridge|2
Wholemeal bread|Gardenia|400 g|Bread & bakery|Kitchen cabinet|
White bread|Gardenia|600 g|Bread & bakery|Kitchen cabinet|
Wholemeal bread|Sunshine|400 g|Bread & bakery|Kitchen cabinet|
Milo powder|Nestlé|1.5 kg|Drinks|Kitchen cabinet|90
Milo 3-in-1 sachets|Nestlé|18 x 33 g|Drinks|Kitchen cabinet|
Kopi-O 2-in-1 sachets|Owl|20 sachets|Drinks|Kitchen cabinet|
White coffee 3-in-1|Old Town|15 sachets|Drinks|Kitchen cabinet|
Instant coffee|Nescafé Classic|200 g|Drinks|Kitchen cabinet|90
Coffee capsules|Nespresso|10 capsules|Drinks|Kitchen cabinet|
Tea bags|Lipton Yellow Label|100 bags|Drinks|Kitchen cabinet|
Tea bags|Boh|100 bags|Drinks|Kitchen cabinet|
Isotonic drink (24 cans)|100PLUS|24 x 325 ml|Drinks|Store room|
Soya bean drink|Yeo's|24 x 250 ml|Drinks|Store room|2
Green tea (no sugar)|Pokka|24 x 500 ml|Drinks|Store room|
Coca-Cola (24 cans)|Coca-Cola|24 x 320 ml|Drinks|Store room|
Mineral water (24 bottles)|Ice Mountain|24 x 600 ml|Drinks|Store room|
Cream crackers|Hup Seng|428 g|Snacks|Kitchen cabinet|14
Peanut butter sandwich biscuits|Julie's|360 g|Snacks|Kitchen cabinet|14
Assorted biscuits tin|Khong Guan|600 g|Snacks|Kitchen cabinet|30
Potato chips|Lay's|170 g|Snacks|Kitchen cabinet|3
Roasted peanuts|Pagoda|150 g|Snacks|Kitchen cabinet|14
Seaweed snack|Tao Kae Noi|36 g|Snacks|Kitchen cabinet|3
Mamee Monster|Mamee|8 x 25 g|Snacks|Kitchen cabinet|
Infant formula stage 3|Similac|1.8 kg|Baby|Kitchen cabinet|28
Growing up milk|Friso|1.8 kg|Baby|Kitchen cabinet|28
Diapers (tape)|MamyPoko|Jumbo pack|Baby|Store room|
Diapers (pants)|Huggies|Jumbo pack|Baby|Store room|
Baby wipes|Pigeon|80 sheets|Baby|Store room|30
Laundry liquid|Dynamo|2.7 kg|Laundry & cleaning|Laundry|
Laundry liquid|Breeze|3.6 kg|Laundry & cleaning|Laundry|
Laundry powder|Attack|2.25 kg|Laundry & cleaning|Laundry|
Fabric softener|Downy|2.4 L|Laundry & cleaning|Laundry|
Bleach|Clorox|2 L|Laundry & cleaning|Laundry|
Dishwashing liquid|Mama Lemon|800 ml|Laundry & cleaning|Kitchen cabinet|
Dishwashing liquid|Sunlight|900 ml|Laundry & cleaning|Kitchen cabinet|
Dishwasher tablets|Finish|60 tablets|Laundry & cleaning|Kitchen cabinet|
Floor cleaner|Dettol|2.5 L|Laundry & cleaning|Store room|
Kitchen cleaner spray|Mr Muscle|500 ml|Laundry & cleaning|Kitchen cabinet|
Toilet bowl cleaner|Harpic|500 ml|Laundry & cleaning|Bathroom|
Insect spray|Baygon|600 ml|Laundry & cleaning|Store room|
Mosquito repellent|Ridsect|Liquid refill|Laundry & cleaning|Store room|
Scouring pads|Scotch-Brite|6 pack|Kitchen & paper|Kitchen cabinet|
Bathroom tissue (10 rolls)|Kleenex|10 rolls|Kitchen & paper|Store room|
Bathroom tissue (10 rolls)|Paseo|10 rolls|Kitchen & paper|Store room|
Facial tissue (box)|Kleenex|5 boxes|Kitchen & paper|Store room|
Kitchen towel|Scott|3 rolls|Kitchen & paper|Kitchen cabinet|
Cling wrap|Glad|30 m|Kitchen & paper|Kitchen cabinet|
Zip bags (medium)|Ziploc|20 bags|Kitchen & paper|Kitchen cabinet|
Aluminium foil|Diamond|25 ft|Kitchen & paper|Kitchen cabinet|
Garbage bags|FairPrice|Medium, 30 bags|Kitchen & paper|Store room|
Toothpaste|Colgate|160 g|Toiletries|Bathroom|
Toothpaste|Darlie|200 g|Toiletries|Bathroom|
Toothbrushes|Colgate|3 pack|Toiletries|Bathroom|
Mouthwash|Listerine|750 ml|Toiletries|Bathroom|
Shampoo|Head & Shoulders|720 ml|Toiletries|Bathroom|
Shampoo|Pantene|900 ml|Toiletries|Bathroom|
Body wash|Lux|950 ml|Toiletries|Bathroom|
Body wash|Lifebuoy|950 ml|Toiletries|Bathroom|
Hand wash|Dettol|250 ml|Toiletries|Bathroom|
Hand sanitiser|Dettol|200 ml|Toiletries|Bathroom|
Sanitary pads|Kotex|Pack|Toiletries|Bathroom|
Shaving cartridges|Gillette|4 pack|Toiletries|Bathroom|
Sunscreen|Bioré|50 g|Toiletries|Bathroom|365
Paracetamol tablets|Panadol|20 tablets|Medicine & first aid|Medicine box|
Children's paracetamol syrup|Panadol|60 ml|Medicine & first aid|Medicine box|
Throat lozenges|Strepsils|16 lozenges|Medicine & first aid|Medicine box|
Tiger Balm (red)|Tiger Balm|19.4 g|Medicine & first aid|Medicine box|
Medicated oil|Axe Brand|10 ml|Medicine & first aid|Medicine box|
Plasters|Band-Aid|40 strips|Medicine & first aid|Medicine box|
Antiseptic liquid|Dettol|500 ml|Medicine & first aid|Medicine box|
Eye drops|Rohto|13 ml|Medicine & first aid|Medicine box|28
Oral rehydration salts|Hydrite|Sachets|Medicine & first aid|Medicine box|
Antigen rapid test kits|ART kit|5 tests|Medicine & first aid|Medicine box|
Cat food (dry)|Whiskas|1.2 kg|Pet|Store room|60
Dog food (dry)|Pedigree|1.5 kg|Pet|Store room|60
Frozen dumplings|CJ Bibigo|1 kg|Frozen|Freezer|
Frozen chicken nuggets|CP|1 kg|Frozen|Freezer|
Frozen fish balls|DoDo|500 g|Frozen|Freezer|
Frozen mixed vegetables|FairPrice|1 kg|Frozen|Freezer|
Ice cream tub|Magnolia|1.5 L|Frozen|Freezer|
Chicken breast|Fresh (generic)|500 g|Meat & seafood|Fridge|
Minced pork|Fresh (generic)|300 g|Meat & seafood|Fridge|
Bananas|Fresh (generic)|1 bunch|Fresh produce|Kitchen cabinet|
Garlic|Fresh (generic)|3 bulbs|Fresh produce|Kitchen cabinet|
Onions|Fresh (generic)|1 kg|Fresh produce|Kitchen cabinet|
Potatoes|Fresh (generic)|1 kg|Fresh produce|Kitchen cabinet|
`;

// ---- how long things usually keep (a guessed best-before date on Add, Bought more, Put away and Say or type) ----
// Rough, unopened, from the shelf: the label always wins, and the date is shown as a guess the person can change.
// null: no date that matters (salt, tissue, soap). A product's own line first (by its name), then its category.
const SHELF_BY_NAME = [
  [/^(salt|(fine |brown |rock )?sugar)\b/i, null],
  [/\bfresh milk\b|\bmilk \(fresh\)/i, 7], [/\buht\b/i, 180], [/yoghurt|yogurt/i, 10], [/cultured milk|yakult/i, 21],
  [/\beggs?\b/i, 14], [/tofu/i, 4], [/butter|margarine/i, 60], [/cheese/i, 30], [/\bkaya\b/i, 30],
  [/\b(bread|buns?|wraps?|pau)\b/i, 5], [/banana/i, 5], [/\b(garlic|onions?|potato(es)?)\b/i, 30],
  [/ice cream/i, 180], [/instant noodles?|mee goreng/i, 240], [/\b(sardines|tuna|baked beans|luncheon meat)\b/i, 730],
  [/\b(chicken|pork|beef|mutton|fish|prawns?|salmon|minced)\b/i, 2],
];
const SHELF_BY_CATEGORY = {
  'Sauces & condiments': 365, 'Rice, noodles & grains': 365, 'Canned & jarred': 730, 'Cooking & baking': 365,
  'Breakfast & spreads': 180, Drinks: 270, 'Dairy & eggs': 14, 'Bread & bakery': 5, 'Fresh produce': 7, 'Meat & seafood': 2,
  Frozen: 180, Snacks: 180, Baby: 365, 'Laundry & cleaning': null, 'Kitchen & paper': null, Toiletries: null,
  'Medicine & first aid': 730, Pet: 365, Leftovers: 3, Other: null,
};
// Days a product usually keeps from the day it's bought ({ name, category }), or null when no date matters or is known.
// Frozen goods and things in a freezer keep FROZEN_DAYS.
export function shelfDays({ name = '', category = '' } = {}) {
  if (category !== 'Frozen') for (const [re, d] of SHELF_BY_NAME) if (re.test(name)) return d;   // frozen nuggets aren't 2-day chicken
  return category in SHELF_BY_CATEGORY ? SHELF_BY_CATEGORY[category] : null;
}
// Freezing pauses the clock: frozen, food keeps about a year (bread about a month); thawed, use within 3 days.
export const FROZEN_DAYS = 365, THAW_DAYS = 3;
export const freezeDays = ({ name = '', category = '' } = {}) => (category === 'Bread & bakery' || /\bbread\b/i.test(name) ? 30 : FROZEN_DAYS);
// Things it makes sense to freeze (food); household goods, medicine and pet food don't get Freeze.
const NOT_FOOD = new Set(['Laundry & cleaning', 'Kitchen & paper', 'Toiletries', 'Medicine & first aid', 'Pet']);
export const freezable = ({ category = '' } = {}) => !NOT_FOOD.has(category);

export const CATALOGUE = RAW.trim().split('\n').map((line, i) => {
  const [name, brand, size, category, location, open] = line.split('|');
  return { key: 'c' + i, name, brand: brand.includes('(generic)') ? '' : brand, size, category, location, openDays: open ? Number(open) : null };
});
