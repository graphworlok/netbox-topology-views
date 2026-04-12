from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_topology_views', '0014_individualoptions_show_arp_neighbors'),
    ]

    operations = [
        migrations.AddField(
            model_name='individualoptions',
            name='show_l3_topology',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='individualoptions',
            name='show_virtual_machines',
            field=models.BooleanField(default=False),
        ),
    ]
