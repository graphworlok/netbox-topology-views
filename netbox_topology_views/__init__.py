from netbox.plugins import PluginConfig


class TopologyViewsConfig(PluginConfig):
    name = "netbox_topology_views"
    verbose_name = "Topology views"
    description = "A plugin to render topology maps"
    version = "4.5.1"
    author = "Mattijs Vanhaverbeke"
    author_email = "author@example.com"
    base_url = "netbox_topology_views"
    required_settings = []
    default_settings = {
        "static_image_directory": "netbox_topology_views/img",
        "allow_coordinates_saving": False,
        "always_save_coordinates": False,
        # InfluxDB/Collectd integration for real-time device status overlay
        # Set influxdb_url to enable the alert-status endpoint
        "influxdb_url": "",           # e.g. "http://influxdb:8086"
        "influxdb_token": "",         # InfluxDB 2.x API token (leave empty for v1)
        "influxdb_org": "",           # InfluxDB 2.x organisation
        "influxdb_bucket": "",        # InfluxDB 2.x bucket name
        "influxdb_database": "",      # InfluxDB 1.x database name
        "influxdb_measurement": "cpu_value",  # measurement used for heartbeat detection
        "influxdb_host_tag": "host",  # Collectd tag that holds the hostname
        "influxdb_stale_minutes": 15, # minutes of silence before device is "offline"
    }

    def ready(self):
        from . import signals

        super().ready()


config = TopologyViewsConfig
