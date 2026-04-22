from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_topology_views', '0015_individualoptions_l3_vms'),
    ]

    operations = [
        migrations.AddField(
            model_name='coordinategroup',
            name='background_image_url',
            field=models.CharField(
                blank=True,
                default='',
                help_text='URL of a background image to display behind the topology canvas (e.g. a floor-plan or site map).',
                max_length=500,
            ),
            preserve_default=False,
        ),
    ]
