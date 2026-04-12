from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_topology_views', '0013_individualoptions_draw_cable_labels'),
    ]

    operations = [
        migrations.AddField(
            model_name='individualoptions',
            name='show_arp_neighbors',
            field=models.BooleanField(default=False),
        ),
    ]
