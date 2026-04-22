"""
Convert a Natural Earth shapefile to an equirectangular SVG suitable for the
netbox-topology-views global geographic map.

Output coordinate system matches geo_global.js / _build_geo_global_data():
    x = (lon / 180) * 900   → range [-900, 900]
    y = -(lat / 90)  * 450  → range [-450, 450]

SVG viewBox is "0 0 1800 900" with origin shifted so (0,0) lon/lat → (900,450).

Usage:
    pip install pyshp
    python shp_to_svg.py ne_110m_admin_0_countries.shp world_map.svg
"""

import sys
import struct


# ---------------------------------------------------------------------------
# Minimal shapefile parser (no dependencies beyond stdlib)
# ---------------------------------------------------------------------------

def _read_int_be(f):
    return struct.unpack('>i', f.read(4))[0]

def _read_int_le(f):
    return struct.unpack('<i', f.read(4))[0]

def _read_double_le(f):
    return struct.unpack('<d', f.read(8))[0]


def read_shapefile(path):
    """Yield lists of rings (each ring = list of (lon, lat) tuples) per record."""
    with open(path, 'rb') as f:
        # File header (100 bytes)
        f.read(100)

        while True:
            header = f.read(8)
            if len(header) < 8:
                break
            content_length = struct.unpack('>i', header[4:8])[0] * 2  # in bytes

            data = f.read(content_length)
            if len(data) < content_length:
                break

            shape_type = struct.unpack('<i', data[0:4])[0]

            # Type 5 = Polygon, Type 15 = PolygonZ, Type 25 = PolygonM
            if shape_type not in (5, 15, 25):
                continue

            # Bounding box (skip 4 doubles = 32 bytes)
            num_parts  = struct.unpack('<i', data[36:40])[0]
            num_points = struct.unpack('<i', data[40:44])[0]

            # Part start indices
            parts = [struct.unpack('<i', data[44 + i*4: 48 + i*4])[0]
                     for i in range(num_parts)]

            # Points
            base = 44 + num_parts * 4
            points = []
            for i in range(num_points):
                x = struct.unpack('<d', data[base + i*16:     base + i*16 + 8])[0]
                y = struct.unpack('<d', data[base + i*16 + 8: base + i*16 + 16])[0]
                points.append((x, y))

            # Split into rings
            rings = []
            for i, start in enumerate(parts):
                end = parts[i + 1] if i + 1 < num_parts else num_points
                rings.append(points[start:end])

            yield rings


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------

SVG_W = 1800
SVG_H = 900

def project(lon, lat):
    """Equirectangular: lon/lat in degrees → SVG pixel coords."""
    x = (lon / 180.0) * (SVG_W / 2) + SVG_W / 2
    y = -(lat / 90.0) * (SVG_H / 2) + SVG_H / 2
    return x, y


def ring_to_path(ring):
    if len(ring) < 2:
        return ''
    parts = []
    for i, (lon, lat) in enumerate(ring):
        x, y = project(lon, lat)
        cmd = 'M' if i == 0 else 'L'
        parts.append(f'{cmd}{x:.1f},{y:.1f}')
    parts.append('Z')
    return ''.join(parts)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print(f'Usage: python {sys.argv[0]} <input.shp> <output.svg>')
        sys.exit(1)

    shp_path = sys.argv[1]
    svg_path = sys.argv[2]

    print(f'Reading {shp_path} ...')
    all_paths = []
    record_count = 0
    for rings in read_shapefile(shp_path):
        record_count += 1
        for ring in rings:
            d = ring_to_path(ring)
            if d:
                all_paths.append(d)

    print(f'  {record_count} records, {len(all_paths)} rings')

    path_data = ' '.join(all_paths)

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_W} {SVG_H}" width="{SVG_W}" height="{SVG_H}">
  <rect width="{SVG_W}" height="{SVG_H}" fill="#1a2a3a"/>
  <!-- Graticule -->
  <g stroke="#2a4a6a" stroke-width="0.4" fill="none">
    <!-- Longitude lines every 30 deg -->
    {''.join(f'<line x1="{(lon/180+1)*900:.0f}" y1="0" x2="{(lon/180+1)*900:.0f}" y2="{SVG_H}"/>'
             for lon in range(-150, 180, 30))}
    <!-- Latitude lines every 30 deg -->
    {''.join(f'<line x1="0" y1="{-(lat/90)*450+450:.0f}" x2="{SVG_W}" y2="{-(lat/90)*450+450:.0f}"/>'
             for lat in range(-60, 90, 30))}
  </g>
  <!-- Prime meridian / Equator -->
  <line x1="900" y1="0" x2="900" y2="{SVG_H}" stroke="#3a6a9a" stroke-width="0.8"/>
  <line x1="0" y1="450" x2="{SVG_W}" y2="450" stroke="#3a6a9a" stroke-width="0.8"/>
  <!-- Countries -->
  <path d="{path_data}" fill="#1e3a2a" stroke="#3a6a4a" stroke-width="0.5" fill-rule="evenodd"/>
</svg>
'''

    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg)

    print(f'Written {svg_path}  ({len(svg):,} bytes)')


if __name__ == '__main__':
    main()
