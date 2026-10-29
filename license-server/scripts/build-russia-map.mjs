/**
 * Генератор векторной карты субъектов РФ для лендинга work.odant.org.
 *
 * Источник: OSM-границы субъектов (github.com/timurkanaz/Russia_geojson_OSM, Russia_regions.geojson).
 * Топологическое упрощение (общие границы соседей упрощаются один раз — без щелей),
 * равновеликая коническая проекция Альберса (центральный меридиан 100° в. д.),
 * подписи — в полюсе недоступности (polylabel).
 *
 * Запуск (зависимости ставятся во временную папку, в пакет не входят):
 *   npm i d3-geo topojson-server topojson-simplify topojson-client polylabel
 *   node build-russia-map.mjs <Russia_regions.geojson> <out/russia-regions.json>
 */
import fs from 'node:fs';
import { geoConicEqualArea, geoPath, geoArea } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, filter, filterWeight, sphericalTriangleArea, sphericalRingArea } from 'topojson-simplify';
import { feature } from 'topojson-client';
import polylabel from 'polylabel';

const NAME_TO_CODE = {
    'Алтайский край': 'RU-ALT', 'Амурская обл.': 'RU-AMU', 'Архангельская обл.': 'RU-ARK', 'Астраханская обл.': 'RU-AST',
    'Белгородская обл.': 'RU-BEL', 'Брянская обл.': 'RU-BRY', 'Владимирская обл.': 'RU-VLA', 'Волгоградская обл.': 'RU-VGG',
    'Вологодская обл.': 'RU-VLG', 'Воронежская обл.': 'RU-VOR', 'Еврейская АО': 'RU-YEV', 'Забайкальский край': 'RU-ZAB',
    'Ивановская обл.': 'RU-IVA', 'Иркутская обл.': 'RU-IRK', 'Кабардино-Балкарская Республика': 'RU-KB',
    'Калининградская обл.': 'RU-KGD', 'Калужская обл.': 'RU-KLU', 'Камчатский край': 'RU-KAM',
    'Карачаево-Черкесская Республика': 'RU-KC', 'Кемеровская обл. - Кузбасс': 'RU-KEM', 'Кировская обл.': 'RU-KIR',
    'Костромская обл.': 'RU-KOS', 'Краснодарский край': 'RU-KDA', 'Красноярский край': 'RU-KYA', 'Курганская обл.': 'RU-KGN',
    'Курская обл.': 'RU-KRS', 'Ленинградская обл.': 'RU-LEN', 'Липецкая обл.': 'RU-LIP', 'Магаданская обл.': 'RU-MAG',
    'Московская обл.': 'RU-MOS', 'Мурманская обл.': 'RU-MUR', 'Ненецкий АО': 'RU-NEN', 'Нижегородская обл.': 'RU-NIZ',
    'Новгородская обл.': 'RU-NGR', 'Новосибирская обл.': 'RU-NVS', 'Омская обл.': 'RU-OMS', 'Оренбургская обл.': 'RU-ORE',
    'Орловская обл.': 'RU-ORL', 'Пензенская обл.': 'RU-PNZ', 'Пермский край': 'RU-PER', 'Приморский край': 'RU-PRI',
    'Псковская обл.': 'RU-PSK', 'Республика Адыгея (Адыгея)': 'RU-AD', 'Республика Алтай': 'RU-AL',
    'Республика Башкортостан': 'RU-BA', 'Республика Бурятия': 'RU-BU', 'Республика Дагестан': 'RU-DA',
    'Республика Ингушетия': 'RU-IN', 'Республика Калмыкия': 'RU-KL', 'Республика Карелия': 'RU-KR', 'Республика Коми': 'RU-KO',
    'Республика Крым': 'RU-CR', 'Республика Марий Эл': 'RU-ME', 'Республика Мордовия': 'RU-MO',
    'Республика Саха (Якутия)': 'RU-SA', 'Республика Северная Осетия - Алания': 'RU-SE',
    'Республика Татарстан (Татарстан)': 'RU-TA', 'Республика Тыва': 'RU-TY', 'Республика Хакасия': 'RU-KK',
    'Ростовская обл.': 'RU-ROS', 'Рязанская обл.': 'RU-RYA', 'Самарская обл.': 'RU-SAM', 'Саратовская обл.': 'RU-SAR',
    'Сахалинская обл.': 'RU-SAK', 'Свердловская обл.': 'RU-SVE', 'Смоленская обл.': 'RU-SMO', 'Ставропольский край': 'RU-STA',
    'Тамбовская обл.': 'RU-TAM', 'Тверская обл.': 'RU-TVE', 'Томская обл.': 'RU-TOM', 'Тульская обл.': 'RU-TUL',
    'Тюменская обл.': 'RU-TYU', 'Удмуртская Республика': 'RU-UD', 'Ульяновская обл.': 'RU-ULY', 'Хабаровский край': 'RU-KHA',
    'Ханты-Мансийский АО - Югра': 'RU-KHM', 'Челябинская обл.': 'RU-CHE', 'Чеченская Республика': 'RU-CE',
    'Чувашская Республика - Чувашия': 'RU-CU', 'Чукотский АО': 'RU-CHU', 'Ямало-Ненецкий АО': 'RU-YAN',
    'Ярославская обл.': 'RU-YAR', 'г. Москва': 'RU-MOW', 'г. Санкт-Петербург': 'RU-SPE',
    'город федерального значения Севастополь': 'RU-SEV',
};

const [, , srcPath, outPath] = process.argv;
const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

// d3-geo ожидает внешние кольца по часовой стрелке; кольца с «обратной» ориентацией разворачиваем
function fixWinding(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
        if (geoArea({ type: 'Polygon', coordinates: [poly[0]] }) > 2 * Math.PI)
            poly.forEach(ring => ring.reverse());
    }
    return geom;
}

const features = src.features.map(f => {
    const code = NAME_TO_CODE[f.properties.region];
    if (!code)
        throw new Error('Нет кода для ' + f.properties.region);
    return { type: 'Feature', properties: { code }, geometry: fixWinding(f.geometry) };
});

// Пороги в стерадианах: 1 px итоговой карты ≈ 0.0015 рад; кольца (острова) меньше ~400 км² отбрасываются
const MIN_TRIANGLE_SR = Number(process.env.MIN_TRIANGLE_SR || 1.2e-6);
const MIN_RING_SR = Number(process.env.MIN_RING_SR || 1e-5);
let topo = topology({ regions: { type: 'FeatureCollection', features } }, 1e6);
topo = presimplify(topo, sphericalTriangleArea);
topo = filter(topo, filterWeight(topo, MIN_RING_SR, sphericalRingArea));
topo = simplify(topo, MIN_TRIANGLE_SR);
const fc = feature(topo, topo.objects.regions);

const WIDTH = 1000;
const projection = geoConicEqualArea().rotate([-100, 0]).parallels([52, 68]).fitWidth(WIDTH - 20, fc);
const path0 = geoPath(projection);
const [[x0, y0], [, y1]] = path0.bounds(fc);
const [tx, ty] = projection.translate();
projection.translate([tx - x0 + 10, ty - y0 + 10]);
const HEIGHT = Math.ceil(y1 - y0 + 20);
const path = geoPath(projection).digits(1);

const regions = fc.features.map(f => {
    const d = path(f);
    // Подпись — в полюсе недоступности самого крупного полигона субъекта
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestArea = -1;
    for (const poly of polys) {
        const a = path0.area({ type: 'Polygon', coordinates: poly });
        if (a > bestArea) { bestArea = a; best = poly; }
    }
    const projected = best.map(ring => ring.map(pt => projection(pt)));
    const p = polylabel(projected, 0.5);
    const [[bx0, by0], [bx1, by1]] = path.bounds(f);
    return {
        code: f.properties.code,
        d,
        cx: Math.round(p[0] * 10) / 10,
        cy: Math.round(p[1] * 10) / 10,
        bbox: [bx0, by0, bx1, by1].map(v => Math.round(v)),
    };
});

fs.writeFileSync(outPath, JSON.stringify({ width: WIDTH, height: HEIGHT, source: 'OpenStreetMap contributors (ODbL)', regions }));
const size = fs.statSync(outPath).size;
console.log(`regions: ${regions.length}, viewBox 0 0 ${WIDTH} ${HEIGHT}, ${Math.round(size / 1024)} KB`);
