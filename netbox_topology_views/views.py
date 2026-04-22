import json
from functools import reduce
from typing import DefaultDict, Dict, Optional, Union
from itertools import chain

from circuits.models import Circuit, CircuitTermination, ProviderNetwork
from dcim.models import (
    Cable,
    CableTermination,
    Device,
    device_components,
    DeviceRole,
    FrontPort,
    Interface,
    PowerFeed,
    PowerPanel,
    RearPort,
)
try:
    from dcim.models import MACAddress as NetBoxMACAddress
    _HAS_MAC_MODEL = True
except ImportError:
    _HAS_MAC_MODEL = False
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.mixins import PermissionRequiredMixin
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q, QuerySet, Count
from django.db.models.functions import Lower
from django.http import HttpRequest, HttpResponseRedirect, QueryDict
from django.shortcuts import render, get_object_or_404
from django.views.generic import View
from extras.models import Tag, SavedFilter
from wireless.models import WirelessLink
from netbox.views.generic import (
    ObjectView, 
    ObjectListView, 
    ObjectEditView, 
    ObjectDeleteView, 
    ObjectChangeLogView, 
    BulkImportView
)
from netbox_topology_views.filters import DeviceFilterSet, CoordinatesFilterSet, CircuitCoordinatesFilterSet, PowerPanelCoordinatesFilterSet, PowerFeedCoordinatesFilterSet
from netbox_topology_views.forms import (
    DeviceFilterForm, 
    IndividualOptionsForm, 
    CoordinateGroupsForm, 
    CircuitCoordinatesForm, 
    CircuitCoordinatesFilterForm, 
    CircuitCoordinatesImportForm,
    PowerPanelCoordinatesForm, 
    PowerPanelCoordinatesFilterForm, 
    PowerPanelCoordinatesImportForm,
    PowerFeedCoordinatesForm, 
    PowerFeedCoordinatesFilterForm, 
    PowerFeedCoordinatesImportForm,
    CoordinatesForm, 
    CoordinatesFilterForm, 
    CoordinateGroupsImportForm,
    CoordinatesImportForm
)
import netbox_topology_views.models
from netbox_topology_views.models import (
    RoleImage, 
    IndividualOptions, 
    CoordinateGroup, 
    Coordinate, 
    CircuitCoordinate, 
    PowerPanelCoordinate, 
    PowerFeedCoordinate,
)
from netbox_topology_views.tables import CoordinateGroupListTable, CoordinateListTable, CircuitCoordinateListTable, PowerPanelCoordinateListTable, PowerFeedCoordinateListTable
from netbox_topology_views.utils import (
    CONF_IMAGE_DIR,
    find_image_url,
    get_model_role,
    get_model_slug,
    image_static_url,
    LinePattern,
    get_query_settings,
    IMAGE_FILETYPES
)

from netbox_topology_views.choices import NodeLabelItems

def get_image_for_entity(entity: Union[Device, Circuit, PowerPanel, PowerFeed]):
    is_device = isinstance(entity, Device)
    query = (
        {"object_id": entity.role_id}
        if is_device
        else {"content_type_id": ContentType.objects.get_for_model(entity).pk}
    )

    try:
        return RoleImage.objects.get(**query).get_image_url()
    except RoleImage.DoesNotExist:
        return find_image_url(
            entity.role.slug if is_device else get_model_slug(entity.__class__)
        )


def create_node(
    device: Union[Device, Circuit, PowerPanel, PowerFeed], 
    save_coords: bool, 
    node_label_items: list,
    group_id="default"
):
    node = {}
    node_content = ""
    if isinstance(device, ProviderNetwork):
        dev_name = device.name
        node["id"] = f"pn{device.pk}"
        model_name = 'CircuitCoordinate'

        if device.provider is not None:
            node_content += (
                f"<tr><th>Provider: </th><td>{device.provider.name}</td></tr>"
            )
            try:
                for asn_obj in device.provider.asns.all():
                    node_content += (
                        f"<tr><th>Upstream ASN: </th><td>AS{asn_obj.asn}"
                        + (f" ({asn_obj.description})" if asn_obj.description else "")
                        + "</td></tr>"
                    )
            except Exception:
                pass
        if device.service_id:
            node_content += (
                f"<tr><th>Service ID: </th><td>{device.service_id}</td></tr>"
            )
        if device.description:
            node_content += (
                f"<tr><th>Description: </th><td>{device.description}</td></tr>"
            )
    elif isinstance(device, Circuit):
        dev_name = device.cid
        node["id"] = f"c{device.pk}"
        model_name = 'CircuitCoordinate'

        if device.provider is not None:
            node_content += (
                f"<tr><th>Provider: </th><td>{device.provider.name}</td></tr>"
            )
            try:
                for asn_obj in device.provider.asns.all():
                    node_content += (
                        f"<tr><th>Upstream ASN: </th><td>AS{asn_obj.asn}"
                        + (f" ({asn_obj.description})" if asn_obj.description else "")
                        + "</td></tr>"
                    )
            except Exception:
                pass
        if device.type is not None:
            node_content += f"<tr><th>Type: </th><td>{device.type.name}</td></tr>"
    elif isinstance(device, PowerPanel):
        dev_name = device.name
        node["id"] = f"p{device.pk}"
        model_name = 'PowerPanelCoordinate'

        if device.site is not None:
            node_content += f"<tr><th>Site: </th><td>{device.site.name}</td></tr>"
        if device.location is not None:
            node_content += (
                f"<tr><th>Location: </th><td>{device.location.name}</td></tr>"
            )
    elif isinstance(device, PowerFeed):
        dev_name = device.name
        node["id"] = f"f{device.pk}"
        model_name = 'PowerFeedCoordinate'

        if device.power_panel is not None:
            node_content += (
                f"<tr><th>Power Panel: </th><td>{device.power_panel.name}</td></tr>"
            )
        if device.type is not None:
            node_content += f"<tr><th>Type: </th><td>{device.type}</td></tr>"
        if device.supply is not None:
            node_content += f"<tr><th>Supply: </th><td>{device.supply}</td></tr>"
        if device.phase is not None:
            node_content += f"<tr><th>Phase: </th><td>{device.phase}</td></tr>"
        if device.amperage is not None:
            node_content += f"<tr><th>Amperage: </th><td>{device.amperage}</td></tr>"
        if device.voltage is not None:
            node_content += f"<tr><th>Voltage: </th><td>{device.voltage}</td></tr>"
    else:
        model_name = 'Coordinate'
        dev_name = device.name
        if dev_name is None:
            dev_name = device.device_type.full_name

        if device.device_type is not None:
            node_content += (
                f"<tr><th>Type: </th><td>{device.device_type.model}</td></tr>"
            )
        if device.role.name is not None:
            node_content += (
                f"<tr><th>Role: </th><td>{device.role.name}</td></tr>"
            )
        if device.serial != "":
            node_content += f"<tr><th>Serial: </th><td>{device.serial}</td></tr>"
        if device.primary_ip is not None:
            node_content += (
                f"<tr><th>IP Address: </th><td>{device.primary_ip.address}</td></tr>"
            )
        if device.site is not None:
            node_content += f"<tr><th>Site: </th><td>{device.site.name}</td></tr>"
        if device.location is not None:
            node_content += (
                f"<tr><th>Location: </th><td>{device.location.name}</td></tr>"
            )
        if device.rack is not None:
            node_content += f"<tr><th>Rack: </th><td>{device.rack.name}</td></tr>"
        if device.position is not None:
            if device.face is not None:
                node_content += f"<tr><th>Position: </th><td>{device.position} ({device.face})</td></tr>"
            else:
                node_content += (
                    f"<tr><th>Position: </th><td>{device.position}</td></tr>"
                )

        node["id"] = device.pk

        if device.site is not None:
            node["site"] = device.site.name
            node["site_id"] = device.site_id
        if device.location is not None:
            node["location"] = device.location.name
            node["location_id"] = device.location_id
        if device.rack is not None:
            node["rack"] = device.rack.name
            node["rack_id"] = device.rack_id
        if device.virtual_chassis is not None:
            node["virtual_chassis"] = device.virtual_chassis.name
            node["virtual_chassis_id"] = device.virtual_chassis_id

        if device.site is not None and device.site.region is not None:
            node["region"] = device.site.region.name
            node["region_id"] = device.site.region_id

        if device.site is not None and hasattr(device.site, 'country') and device.site.country:
            node["country"] = device.site.country.name
            node["country_code"] = str(device.site.country)

        if device.tenant is not None:
            node["tenant"] = device.tenant.name
            node["tenant_id"] = device.tenant_id

        if device.role.color != "":
            node["color.border"] = "#" + device.role.color

        # Metadata consumed by client-side view type overlays
        node["device_status"] = str(device.status) if device.status else "unknown"
        node["platform_slug"] = device.platform.slug if device.platform else ""
        node["platform_name"] = device.platform.name if device.platform else ""
        node["tenant_slug"]   = device.tenant.slug if device.tenant else ""
        node["tenant_name"]   = device.tenant.name if device.tenant else ""

        # Vulnerability score from custom field (if configured)
        _vuln_cf_score = settings.PLUGINS_CONFIG["netbox_topology_views"].get("vuln_cf_score", "")
        _vuln_cf_sev   = settings.PLUGINS_CONFIG["netbox_topology_views"].get("vuln_cf_severity", "")
        cf = getattr(device, "custom_field_data", {}) or {}
        if _vuln_cf_score and _vuln_cf_score in cf and cf[_vuln_cf_score] is not None:
            try:
                node["vuln_score"] = float(cf[_vuln_cf_score])
            except (ValueError, TypeError):
                pass
        if _vuln_cf_sev and _vuln_cf_sev in cf and cf[_vuln_cf_sev] is not None:
            node["vuln_severity"] = str(cf[_vuln_cf_sev]).lower()

    model_class = getattr(netbox_topology_views.models, model_name)

    if group_id is None or group_id == "default":
        group_id = model_class.get_or_create_default_group(group_id)
        if not group_id:
            print('Exception occured while handling default group.')
            return node
   
    group = get_object_or_404(CoordinateGroup, pk=group_id)

    node["physics"] = True
    # Coords must be set even if no coords have been stored. Otherwise nodes with coords 
    # will not be placed correctly by vis-network.
    node["x"] = 0
    node["y"] = 0
    if model_class.objects.filter(group=group, device=device.pk).values('x') and model_class.objects.filter(group=group, device=device.pk).values('y'):
        # Coordinates data for the device exists in Coordinates Group. Let's assign them
        node["x"] = model_class.objects.get(group=group, device=device.pk).x
        node["y"] = model_class.objects.get(group=group, device=device.pk).y
        node["physics"] = False
    elif "coordinates" in device.custom_field_data:
        # We prefer the new Coordinate model but leave the deprecated method 
        # for now as fallback for compatibility reasons
        if device.custom_field_data["coordinates"] is not None:
            if ";" in device.custom_field_data["coordinates"]:
                cords = device.custom_field_data["coordinates"].split(";")
                node["x"] = int(cords[0])
                node["y"] = int(cords[1])
                node["physics"] = False

    dev_title = "<table><tbody> %s</tbody></table>" % (node_content)
    node["title"] = dev_title
    node["name"] = dev_name

    # Create a list of possible label items. Omit None types
    label_mapping = {
        NodeLabelItems.DEVICE_NAME: dev_name,
        NodeLabelItems.DEVICE_TYPE: getattr(device, 'device_type', None), 
        NodeLabelItems.ROLE: getattr(device, 'role', None), 
        NodeLabelItems.DESCRIPTION: getattr(device, 'description', None),
        NodeLabelItems.PRIMARY_IPV4: getattr(device, 'primary_ip4', None), 
        NodeLabelItems.PRIMARY_IPV6: getattr(device, 'primary_ip6', None),
        NodeLabelItems.OUT_OF_BAND_IP: getattr(device, 'oob_ip', None), 
        NodeLabelItems.PLATFORM: getattr(device, 'platform', None), 
        NodeLabelItems.SERIAL: getattr(device, 'serial', None), 
        NodeLabelItems.TENANT: getattr(device, 'tenant', None), 
        NodeLabelItems.SITE: getattr(device, 'site', None), 
        NodeLabelItems.LOCATION: getattr(device, 'location', None), 
        NodeLabelItems.RACK: getattr(device, 'rack', None), 
        NodeLabelItems.VIRTUAL_CHASSIS: getattr(device, 'virtual_chassis', None), 
        NodeLabelItems.ASSET_TAG: getattr(device, 'asset_tag', None),
    }

    label_items = []
    for item in node_label_items:
        if label_mapping[item] and label_mapping[item] is not None:
            label_items.append(str(label_mapping[item]))
    node_label = '\n'.join(label_items)

    node["label"] = node_label
    node["shape"] = "image"
    node["href"] = device.get_absolute_url()
    node["image"] = get_image_for_entity(device)
    node["label_num_lines"] = len(label_items)

    return node


def create_edge(
    edge_id: int,
    termination_a: Dict,
    termination_b: Dict,
    straight_cables: bool,
    draw_termination_labels: bool,
    draw_cable_labels: bool,
    circuit: Optional[Dict] = None,
    cable: Optional[Cable] = None,
    wireless: Optional[Dict] = None,
    power: Optional[bool] = None,
    interface: Optional[Interface] = None,
):
    cable_a_name = (
        "device A name unknown"
        if termination_a["termination_name"] is None
        else termination_a["termination_name"]
    )
    cable_a_dev_name = (
        "device A name unknown"
        if termination_a["termination_device_name"] is None
        else termination_a["termination_device_name"]
    )
    cable_b_name = (
        "device A name unknown"
        if termination_b["termination_name"] is None
        else termination_b["termination_name"]
    )
    cable_b_dev_name = (
        "cable B name unknown"
        if termination_b["termination_device_name"] is None
        else termination_b["termination_device_name"]
    )

    edge = {}
    edge["id"] = edge_id
    edge["from"] = termination_a["device_id"]
    edge["to"] = termination_b["device_id"]
    edge["color"] = '#2b7ce9'
    title = "Cable"

    if circuit is not None:
        edge["connection_type"] = "circuit"
        edge["dashes"] = True
        title = f"Circuit provider: {circuit['provider_name']}<br>Termination"

    elif wireless is not None:
        edge["connection_type"] = "wireless"
        edge["dashes"] = LinePattern().wireless
        title = "Wireless Connection"

    elif power is not None:
        edge["connection_type"] = "power"
        edge["dashes"] = LinePattern().power
        title = "Power Connection"

    elif interface is not None:
        edge["connection_type"] = "logical"
        title = "Interface Connection"
        edge["width"] = 3
        edge["dashes"] = LinePattern().logical
        edge["color"] = '#f1c232'
        edge["href"] = interface.get_absolute_url() + "trace"

    else:
        edge["connection_type"] = "cable"
    
    if cable is not None and hasattr(cable, "label") and cable.label:
        cable_label = "<br>Label: " + cable.label
        if draw_cable_labels is True:
            edge["label"] = cable.label
    else:
        cable_label = ""

    edge[
        "title"
    ] = f"{title} between<br>{cable_a_dev_name} [{cable_a_name}]<br>{cable_b_dev_name} [{cable_b_name}] {cable_label}"

    if cable is not None:
        edge["href"] = cable.get_absolute_url()
        if hasattr(cable, 'color') and cable.color != "":
            edge["color"] = "#" + cable.color

    # if straight_cables == True: edge["smooth"] = False
    edge["smooth"] = not straight_cables

    if draw_termination_labels is True:
        edge["drawTerminationLabel"] = True
        edge["cable_a_name"] = cable_a_name
        edge["cable_b_name"] = cable_b_name


    return edge


def create_circuit_termination(termination):
    if isinstance(termination, CircuitTermination):
        return {
            "termination_name": termination.circuit.provider.name,
            "termination_device_name": termination.circuit.cid,
            "device_id": "c{}".format(termination.circuit.pk),
        }
    if (
        isinstance(termination, Interface)
        or isinstance(termination, FrontPort)
        or isinstance(termination, RearPort)
    ):
        return {
            "termination_name": termination.name,
            "termination_device_name": termination.device.name,
            "device_id": termination.device.pk,
        }
    return None


def get_topology_data(
    queryset: QuerySet,
    individualOptions: IndividualOptions,
    show_unconnected: bool,
    ignore_cable_type: list,
    save_coords: bool,
    show_cables: bool,
    show_circuit: bool,
    show_logical_connections: bool,
    show_single_cable_logical_conns: bool,
    show_neighbors: bool,
    show_power: bool,
    show_wireless: bool,
    group_sites: bool,
    group_locations: bool,
    group_racks: bool,
    group_virtualchassis: bool,
    group_id,
    straight_cables: bool,
    draw_termination_labels: bool,
    draw_cable_labels: bool,
    grid_size: list,
    node_label_items: list,
    show_arp_neighbors: bool = False,
    show_l3_topology: bool = False,
    show_virtual_machines: bool = False,
):
    
    supported_termination_types = []
    for t in IndividualOptions.CHOICES:
        supported_termination_types.append(t[1])

    if not queryset:
        return None

    nodes_devices = {}
    edges = []
    nodes = []
    options = {}
    edge_ids = 0
    nodes_circuits: Dict[int, Circuit] = {}
    nodes_powerpanel: Dict[int, PowerPanel] = {}
    nodes_powerfeed: Dict[int, PowerFeed] = {}
    nodes_provider_networks = {}
    cable_ids = DefaultDict(dict)
    interface_ids = DefaultDict(dict)

    device_ids = [d.pk for d in queryset]
    site_ids = [d.site_id for d in queryset]

    if show_neighbors:
        interfaces = Interface.objects.filter(
            Q(device_id__in=device_ids)
        )
        frontports = FrontPort.objects.filter(
            Q(device_id__in=device_ids)
        )
        rearports = RearPort.objects.filter(
            Q(device_id__in=device_ids)
        )

        ports = chain(interfaces, frontports, rearports)
        for port in ports:
            for link_peer in port.link_peers:
                if hasattr(link_peer, 'device') and link_peer.device.id not in device_ids:
                    device_ids.append(link_peer.device.id)

        if show_logical_connections:
            path_complete_interfaces = Interface.objects.filter(
                Q(_path__is_complete=True) & Q(device_id__in=device_ids)
            )
            for path_complete_interface in path_complete_interfaces:
                for connected_endpoint in path_complete_interface.connected_endpoints:
                    if type(connected_endpoint) != ProviderNetwork:
                        device_ids.append(connected_endpoint.device.id)

    if show_circuit:
        circuit_terminations = CircuitTermination.objects.filter(
            Q(_site_id__in=site_ids) | Q(_provider_network__isnull=False)
        )
        for circuit_termination in circuit_terminations:
            circuit_termination: CircuitTermination
            if (
                show_unconnected
                and circuit_termination.circuit_id not in nodes_circuits
            ):
                nodes_circuits[
                    circuit_termination.circuit.pk
                ] = circuit_termination.circuit

            termination_a = {}
            termination_b = {}
            circuit_model = {}
            if circuit_termination.cable is not None and bool(circuit_termination.cable.a_terminations) and bool(circuit_termination.cable.b_terminations):
                termination_a = create_circuit_termination(
                    circuit_termination.cable.a_terminations[0]
                )
                termination_b = create_circuit_termination(
                    circuit_termination.cable.b_terminations[0]
                )
            elif circuit_termination.termination is not None:
                if (
                    circuit_termination.termination_id
                    not in nodes_provider_networks
                ):
                    nodes_provider_networks[
                        circuit_termination.termination.pk
                    ] = circuit_termination.termination

            if bool(termination_a) and bool(termination_b):
                circuit_model = {
                    "provider_name": circuit_termination.circuit.provider.name
                }
                edge_ids += 1
                edges.append(
                    create_edge(
                        edge_id=edge_ids,
                        cable=circuit_termination.cable,
                        circuit=circuit_model,
                        termination_a=termination_a,
                        termination_b=termination_b,
                        straight_cables=straight_cables,
                        draw_termination_labels=draw_termination_labels,
                        draw_cable_labels=draw_cable_labels,
                    )
                )

                circuit_has_connections = False
                for termination in [
                    circuit_termination.cable.a_terminations[0],
                    circuit_termination.cable.b_terminations[0],
                ]:
                    if not isinstance(termination, CircuitTermination):
                        if (
                            termination.device_id not in nodes_devices
                            and termination.device_id in device_ids
                        ):
                            nodes_devices[termination.device_id] = termination.device
                            circuit_has_connections = True
                        else:
                            if termination.device_id in device_ids:
                                circuit_has_connections = True

                if circuit_has_connections and not show_unconnected:
                    if circuit_termination.circuit_id not in nodes_circuits:
                        nodes_circuits[
                            circuit_termination.circuit.pk
                        ] = circuit_termination.circuit

        for d in nodes_circuits.values():
            nodes.append(create_node(d, save_coords, node_label_items, group_id))

        # Render ProviderNetwork nodes (ISP cloud nodes) and connect them to circuits
        for pn in nodes_provider_networks.values():
            nodes.append(create_node(pn, save_coords, node_label_items, group_id))

        # Add edges between circuits and their provider networks
        for circuit_termination in CircuitTermination.objects.filter(
            Q(_site_id__in=site_ids) | Q(_provider_network__isnull=False)
        ).select_related("circuit__provider", "termination_type"):
            if (circuit_termination.termination is not None
                    and isinstance(circuit_termination.termination, ProviderNetwork)
                    and circuit_termination.termination_id in nodes_provider_networks
                    and circuit_termination.circuit_id in nodes_circuits):
                provider = circuit_termination.circuit.provider
                asn_str = ""
                try:
                    asns = list(provider.asns.all())
                    if asns:
                        asn_str = " · ".join(f"AS{a.asn}" for a in asns)
                except Exception:
                    pass

                provider_label = provider.name if provider else "Unknown Provider"
                if asn_str:
                    provider_label = f"{provider_label} ({asn_str})"

                edge_ids += 1
                edges.append({
                    "id": edge_ids,
                    "from": f"c{circuit_termination.circuit_id}",
                    "to": f"pn{circuit_termination.termination_id}",
                    "color": "#9c27b0",
                    "dashes": True,
                    "connection_type": "isp",
                    "smooth": not straight_cables,
                    "title": (
                        f"Circuit {circuit_termination.circuit.cid}"
                        f"<br>Provider: {provider_label}"
                    ),
                })

    if show_power:
        power_panels_ids = PowerPanel.objects.filter(
            Q(site_id__in=site_ids)
        ).values_list("pk", flat=True)
        power_feeds: QuerySet[PowerFeed] = PowerFeed.objects.filter(
            Q(power_panel_id__in=power_panels_ids)
        )

        for power_feed in power_feeds:
            if show_unconnected or (
                not show_unconnected and power_feed.cable_id is not None
            ):
                if power_feed.power_panel_id not in nodes_powerpanel:
                    nodes_powerpanel[power_feed.power_panel.pk] = power_feed.power_panel

                power_link_name = ""
                if power_feed.pk not in nodes_powerfeed:
                    if not show_unconnected:
                        if power_feed.link_peers[0].device_id in device_ids:
                            nodes_powerfeed[power_feed.pk] = power_feed
                            power_link_name = power_feed.link_peers[0].name
                    else:
                        nodes_powerfeed[power_feed.pk] = power_feed

                edge_ids += 1
                termination_a = {
                    "termination_name": power_feed.power_panel.name,
                    "termination_device_name": "",
                    "device_id": f"p{power_feed.power_panel_id}",
                }
                termination_b = {
                    "termination_name": power_feed.name,
                    "termination_device_name": power_link_name,
                    "device_id": f"f{power_feed.pk}",
                }
                edges.append(
                    create_edge(
                        edge_id=edge_ids,
                        termination_a=termination_a,
                        termination_b=termination_b,
                        power=True,
                        straight_cables=straight_cables,
                        draw_termination_labels=draw_termination_labels,
                        draw_cable_labels=draw_cable_labels,
                    )
                )

                if power_feed.cable_id is not None:
                    cable_ids[power_feed.cable_id][power_feed.cable_end] = termination_b

        for d in nodes_powerfeed.values():
            nodes.append(create_node(d, save_coords, node_label_items ,group_id))

        for d in nodes_powerpanel.values():
            nodes.append(create_node(d, save_coords, node_label_items, group_id))

    if show_logical_connections:
        interfaces = Interface.objects.filter(
            Q(_path__is_complete=True) & Q(device_id__in=device_ids)
        )

        for interface in interfaces:
            # print('{} {} {} {}'.format(interface.device.name, interface.name, interface._path.destinations[0].device.name, interface._path.destinations[0].name))
            for destination in interface._path.destinations:
                if isinstance(destination, device_components.Interface):
                    if destination.device.id not in device_ids:
                        # print('Destination interface not in device queryset, ignoring')
                        continue

                    if destination.id in interface_ids:
                        # we've already captured the destination interface, ignore this connection
                        # print('Destination interface already exists, ignoring')
                        continue

                    if not show_single_cable_logical_conns and interface.cable_id==destination.cable_id and show_cables:
                        # interface connection is the same as the cable connection, ignore this connection
                        continue
            
                    interface_ids[interface.id]=interface
                    edge_ids += 1
                    termination_a = { "termination_name": interface.name, "termination_device_name": interface.device.name, "device_id": interface.device.id }
                    termination_b = { "termination_name": destination.name, "termination_device_name": destination.device.name, "device_id": destination.device.id }
                    edges.append(create_edge(edge_id=edge_ids, termination_a=termination_a, termination_b=termination_b, interface=interface, straight_cables=straight_cables, draw_termination_labels=draw_termination_labels, draw_cable_labels=draw_cable_labels))
                    nodes_devices[interface.device.id] = interface.device
                    nodes_devices[destination.device.id] = destination.device

    if show_cables:
        links: QuerySet[CableTermination] = CableTermination.objects.filter(
            Q(_device_id__in=device_ids)
        ).select_related("termination_type")

        for link in links:
            if link.termination_type.model in ignore_cable_type:
                continue

            # Normal device cables
            if link.termination_type.model in supported_termination_types:
                complete_link = False
                if link.cable_end == "A":
                    if link.cable_id not in cable_ids:
                        cable_ids[link.cable_id] = {}
                    else:
                        if "B" in cable_ids[link.cable_id]:
                            if cable_ids[link.cable_id]["B"] is not None:
                                complete_link = True
                elif link.cable_end == "B":
                    if link.cable_id not in cable_ids:
                        cable_ids[link.cable_id] = {}
                    else:
                        if "A" in cable_ids[link.cable_id]:
                            if cable_ids[link.cable_id]["A"] is not None:
                                complete_link = True
                else:
                    print("Unkown cable end")
                cable_ids[link.cable_id][link.cable_end] = link

                if complete_link:
                    edge_ids += 1
                    if isinstance(cable_ids[link.cable_id]["B"], CableTermination):
                        if cable_ids[link.cable_id]["B"]._device_id not in nodes_devices:
                            nodes_devices[
                                cable_ids[link.cable_id]["B"]._device_id
                            ] = cable_ids[link.cable_id]["B"].termination.device
                        termination_b = {
                            "termination_name": cable_ids[link.cable_id][
                                "B"
                            ].termination.name,
                            "termination_device_name": cable_ids[link.cable_id][
                                "B"
                            ].termination.device.name,
                            "device_id": cable_ids[link.cable_id][
                                "B"
                            ].termination.device_id,
                        }
                    else:
                        termination_b = cable_ids[link.cable_id]["B"]

                    if isinstance(cable_ids[link.cable_id]["A"], CableTermination):
                        if cable_ids[link.cable_id]["A"]._device_id not in nodes_devices:
                            nodes_devices[
                                cable_ids[link.cable_id]["A"]._device_id
                            ] = cable_ids[link.cable_id]["A"].termination.device
                        termination_a = {
                            "termination_name": cable_ids[link.cable_id][
                                "A"
                            ].termination.name,
                            "termination_device_name": cable_ids[link.cable_id][
                                "A"
                            ].termination.device.name,
                            "device_id": cable_ids[link.cable_id][
                                "A"
                            ].termination.device_id,
                        }
                    else:
                        termination_a = cable_ids[link.cable_id]["A"]

                    edges.append(
                        create_edge(
                            edge_id=edge_ids,
                            cable=link.cable,
                            termination_a=termination_a,
                            termination_b=termination_b,
                            straight_cables=straight_cables,
                            draw_termination_labels=draw_termination_labels,
                            draw_cable_labels=draw_cable_labels,
                        )
                    )

    if show_wireless:
        wlan_links: QuerySet[WirelessLink] = WirelessLink.objects.filter(
            Q(_interface_a_device_id__in=device_ids)
            & Q(_interface_b_device_id__in=device_ids)
        )

        for wlan_link in wlan_links:
            if wlan_link.interface_a.device_id not in nodes_devices:
                nodes_devices[
                    wlan_link.interface_a.device.pk
                ] = wlan_link.interface_a.device
            if wlan_link.interface_b.device_id not in nodes_devices:
                nodes_devices[
                    wlan_link.interface_b.device.pk
                ] = wlan_link.interface_b.device

            termination_a = {
                "termination_name": wlan_link.interface_a.name,
                "termination_device_name": wlan_link.interface_a.device.name,
                "device_id": wlan_link.interface_a.device_id,
            }
            termination_b = {
                "termination_name": wlan_link.interface_b.name,
                "termination_device_name": wlan_link.interface_b.device.name,
                "device_id": wlan_link.interface_b.device_id,
            }
            wireless = {"ssid": wlan_link.ssid}

            edge_ids += 1
            edges.append(
                create_edge(
                    edge_id=edge_ids,
                    cable=wlan_link,
                    termination_a=termination_a,
                    termination_b=termination_b,
                    wireless=wireless,
                    straight_cables=straight_cables,
                    draw_termination_labels=draw_termination_labels,
                    draw_cable_labels=draw_cable_labels,
                )
            )

    if group_locations:
        options['group_locations'] = 'on'
    if group_racks:
        options['group_racks'] = 'on'
    if group_sites:
        options['group_sites'] = 'on'
    if group_virtualchassis:
        options['group_virtualchassis'] = 'on'
    if grid_size:
        options['grid_size'] = grid_size
    else:
        options['grid_size'] = list('0')

    for qs_device in queryset:
        if qs_device.pk not in nodes_devices and show_unconnected:
            nodes_devices[qs_device.pk] = qs_device

    # ------------------------------------------------------------------ #
    # ARP / MAC-table ghost nodes
    # Devices visible in the L2 forwarding table of topology device
    # interfaces, but not connected via any defined cable.
    # ------------------------------------------------------------------ #
    if show_arp_neighbors and _HAS_MAC_MODEL:
        try:
            interface_ct = ContentType.objects.get_for_model(Interface)
            topology_iface_qs = Interface.objects.filter(
                device_id__in=list(nodes_devices.keys())
            ).values("id", "device_id")
            topology_iface_ids = [i["id"] for i in topology_iface_qs]
            iface_to_device   = {i["id"]: i["device_id"] for i in topology_iface_qs}

            # Exclude interfaces that are cabled to another topology device —
            # MACs on inter-device uplinks/trunks are transiting, not directly attached.
            # Strategy: find every cable that connects two topology devices, then
            # exclude the interface IDs at both ends of those cables.
            topology_device_id_set = set(nodes_devices.keys())

            # Cables where BOTH ends attach to topology devices
            inter_topo_cable_ids = set(
                CableTermination.objects.filter(
                    _device_id__in=topology_device_id_set
                ).filter(
                    cable_id__in=CableTermination.objects.filter(
                        _device_id__in=topology_device_id_set
                    ).values_list("cable_id", flat=True)
                ).values_list("cable_id", flat=True)
            )

            # Interface (not port/console/power) termination IDs on those cables
            uplink_iface_ids = set(
                CableTermination.objects.filter(
                    cable_id__in=inter_topo_cable_ids,
                    _device_id__in=topology_device_id_set,
                    termination_type__model="interface",
                ).values_list("termination_id", flat=True)
            )

            # Only harvest MACs from interfaces that are NOT inter-topology uplinks
            access_iface_ids = [
                iid for iid in topology_iface_ids if iid not in uplink_iface_ids
            ]

            # Forwarding-table entries on access/uncabled interfaces only (exclude stale)
            learned_mac_entries = list(
                NetBoxMACAddress.objects.filter(
                    assigned_object_type=interface_ct,
                    assigned_object_id__in=access_iface_ids,
                ).exclude(
                    tags__slug="stale"
                ).values("mac_address", "assigned_object_id")
            )

            if learned_mac_entries:
                mac_to_learner_ifaces: Dict[str, set] = {}
                for entry in learned_mac_entries:
                    mac = str(entry["mac_address"]).lower()
                    mac_to_learner_ifaces.setdefault(mac, set()).add(
                        entry["assigned_object_id"]
                    )

                learned_macs = set(mac_to_learner_ifaces.keys())

                # Find NetBox interfaces whose own MAC is in the learned set
                ghost_iface_qs = Interface.objects.filter(
                    mac_address__in=learned_macs
                ).exclude(
                    device_id__in=list(nodes_devices.keys())
                ).select_related(
                    "device",
                    "device__role",
                    "device__device_type",
                    "device__site",
                    "device__location",
                    "device__rack",
                    "device__tenant",
                )

                ghost_node_ids: set = set()

                for ghost_iface in ghost_iface_qs:
                    ghost_dev = ghost_iface.device
                    if ghost_dev.id in nodes_devices or ghost_dev.id in ghost_node_ids:
                        continue

                    # Skip if ghost device is already cabled to a topology device
                    ghost_cables_to_topology = CableTermination.objects.filter(
                        cable_id__in=CableTermination.objects.filter(
                            _device_id=ghost_dev.id
                        ).values_list("cable_id", flat=True),
                        _device_id__in=list(nodes_devices.keys()),
                    ).exists()

                    if ghost_cables_to_topology:
                        continue

                    ghost_node_ids.add(ghost_dev.id)
                    ghost_mac = str(ghost_iface.mac_address).lower()

                    # Find which topology device/interface learned this MAC
                    learner_iface_ids = mac_to_learner_ifaces.get(ghost_mac, set())
                    learner_device_id = None
                    for lid in learner_iface_ids:
                        learner_device_id = iface_to_device.get(lid)
                        if learner_device_id:
                            break

                    if not learner_device_id:
                        continue

                    # Build the ghost node (reuse create_node, then mark it)
                    ghost_node = create_node(
                        ghost_dev, save_coords, node_label_items, group_id
                    )
                    ghost_node["ghost"] = True
                    ghost_node["color"] = {
                        "border":     "#FF8C00",
                        "background": "#FFF3E0",
                        "highlight":  {"border": "#E65100", "background": "#FFE0B2"},
                    }
                    ghost_node["borderWidth"] = 2
                    ghost_node["borderWidthSelected"] = 3
                    nodes.append(ghost_node)

                    # Ghost edge: dashed orange, labelled with MAC
                    edge_ids += 1
                    edges.append({
                        "id":              edge_ids,
                        "from":            learner_device_id,
                        "to":              ghost_dev.id,
                        "color":           "#FF8C00",
                        "dashes":          LinePattern.arp_ghost,
                        "connection_type": "arp_ghost",
                        "smooth":          not straight_cables,
                        "title": (
                            f"L2 visible (ARP/MAC table)"
                            f"<br>MAC: {ghost_mac}"
                            f"<br>No cable defined in NetBox"
                        ),
                    })
        except Exception:
            import traceback
            traceback.print_exc()

    # ------------------------------------------------------------------ #
    # L3 topology — subnet nodes connecting devices that share an IP subnet
    # ------------------------------------------------------------------ #
    if show_l3_topology:
        try:
            from ipaddress import ip_interface as _parse_ip
            from ipam.models import IPAddress as _IPAddress

            iface_ct = ContentType.objects.get_for_model(Interface)
            topo_iface_map = dict(
                Interface.objects.filter(
                    device_id__in=list(nodes_devices.keys())
                ).values_list("id", "device_id")
            )

            dev_ips = _IPAddress.objects.filter(
                assigned_object_type=iface_ct,
                assigned_object_id__in=list(topo_iface_map.keys()),
            ).values("address", "assigned_object_id")

            # Group by network — {net_str: {device_id: ip_str}}
            subnet_map: Dict[str, Dict[int, str]] = {}
            for entry in dev_ips:
                iface_id = entry["assigned_object_id"]
                dev_id = topo_iface_map.get(iface_id)
                if not dev_id:
                    continue
                net = _parse_ip(str(entry["address"])).network
                # Skip /32 and /128 — single-host addresses can't form shared subnets
                if net.prefixlen in (32, 128):
                    continue
                net_str = str(net)
                subnet_map.setdefault(net_str, {})[dev_id] = str(entry["address"])

            for net_str, dev_ip_map in subnet_map.items():
                if len(dev_ip_map) < 2:
                    continue  # only draw when ≥2 topology devices share the subnet

                prefix_node_id = f"l3_{net_str.replace('/', '_').replace('.', '_').replace(':', '_')}"
                nodes.append({
                    "id":      prefix_node_id,
                    "name":    net_str,
                    "label":   net_str,
                    "shape":   "image",
                    "size":    22,
                    "image":   find_image_url("prefix"),
                    "title":   (
                        f"<table><tbody>"
                        f"<tr><th>Subnet:</th><td>{net_str}</td></tr>"
                        f"<tr><th>Devices:</th><td>{len(dev_ip_map)}</td></tr>"
                        f"</tbody></table>"
                    ),
                    "href":    "",
                    "physics": True,
                    "x":       0,
                    "y":       0,
                    "color":   {
                        "border":     "#4CAF50",
                        "background": "#E8F5E9",
                        "highlight":  {"border": "#1B5E20", "background": "#C8E6C9"},
                    },
                    "label_num_lines": 1,
                })

                for dev_id, ip_str in dev_ip_map.items():
                    edge_ids += 1
                    edges.append({
                        "id":              edge_ids,
                        "from":            dev_id,
                        "to":              prefix_node_id,
                        "color":           "#4CAF50",
                        "connection_type": "l3_prefix",
                        "smooth":          not straight_cables,
                        "label":           ip_str.split("/")[0],
                        "title":           f"IP: {ip_str}<br>Subnet: {net_str}",
                        "width":           1,
                    })
        except Exception:
            import traceback
            traceback.print_exc()

    # ------------------------------------------------------------------ #
    # Virtual machine placement
    # VMs with a direct device assignment, or in a cluster hosted on topology devices
    # ------------------------------------------------------------------ #
    if show_virtual_machines:
        try:
            from virtualization.models import VirtualMachine as _VM

            topo_dev_ids = list(nodes_devices.keys())

            # Cluster → first topology device mapping (for cluster-hosted VMs)
            cluster_host_map: Dict[int, int] = {}
            for dev in nodes_devices.values():
                if hasattr(dev, "cluster_id") and dev.cluster_id and dev.cluster_id not in cluster_host_map:
                    cluster_host_map[dev.cluster_id] = dev.pk

            vm_qs = _VM.objects.filter(
                Q(device_id__in=topo_dev_ids) |
                Q(cluster_id__in=list(cluster_host_map.keys()), device__isnull=True)
            ).select_related(
                "role", "cluster", "primary_ip4", "primary_ip6", "tenant", "site", "device"
            )

            seen_vm_ids: set = set()
            for vm in vm_qs:
                if vm.pk in seen_vm_ids:
                    continue
                seen_vm_ids.add(vm.pk)

                # Determine host device node ID
                if vm.device_id and vm.device_id in nodes_devices:
                    host_id = vm.device_id
                elif vm.cluster_id and vm.cluster_id in cluster_host_map:
                    host_id = cluster_host_map[vm.cluster_id]
                else:
                    continue

                # Build tooltip
                vm_content = f"<tr><th>Status:</th><td>{vm.status}</td></tr>"
                if vm.primary_ip4:
                    vm_content += f"<tr><th>IP:</th><td>{vm.primary_ip4.address}</td></tr>"
                elif vm.primary_ip6:
                    vm_content += f"<tr><th>IPv6:</th><td>{vm.primary_ip6.address}</td></tr>"
                if vm.cluster:
                    vm_content += f"<tr><th>Cluster:</th><td>{vm.cluster.name}</td></tr>"
                if vm.tenant:
                    vm_content += f"<tr><th>Tenant:</th><td>{vm.tenant.name}</td></tr>"
                if vm.site:
                    vm_content += f"<tr><th>Site:</th><td>{vm.site.name}</td></tr>"

                vm_image = find_image_url(vm.role.slug if vm.role else "virtual-machine")

                nodes.append({
                    "id":      f"vm{vm.pk}",
                    "name":    vm.name,
                    "label":   vm.name,
                    "shape":   "image",
                    "size":    20,
                    "image":   vm_image,
                    "title":   f"<table><tbody>{vm_content}</tbody></table>",
                    "href":    vm.get_absolute_url(),
                    "physics": True,
                    "x":       0,
                    "y":       0,
                    "color":   {
                        "border":     "#4CAF50",
                        "background": "#E8F5E9",
                        "highlight":  {"border": "#2E7D32", "background": "#C8E6C9"},
                    },
                    "label_num_lines": 1,
                })

                edge_ids += 1
                edges.append({
                    "id":              edge_ids,
                    "from":            f"vm{vm.pk}",
                    "to":              host_id,
                    "color":           "#4CAF50",
                    "dashes":          [5, 3],
                    "connection_type": "vm_host",
                    "smooth":          not straight_cables,
                    "title":           f"VM: {vm.name}<br>Hosted on: {nodes_devices[host_id].name}",
                    "width":           1,
                })
        except Exception:
            import traceback
            traceback.print_exc()

    results = {}

    for d in nodes_devices.values():
        nodes.append(create_node(d, save_coords, node_label_items, group_id))

    results["nodes"] = nodes
    results["edges"] = edges
    results["group"] = group_id
    results["options"] = options
    return results


class MetricsView(PermissionRequiredMixin, View):
    """
    Returns per-device CPU utilisation % (and memory, if available) from
    InfluxDB/Collectd.  Used by the Metrics CPU view type in the topology.
    Query: GET /plugins/netbox_topology_views/metrics/?type=cpu
    """
    permission_required = ("dcim.view_device",)

    def get(self, request):
        from django.http import JsonResponse
        influxdb_url = CONFIG.get("influxdb_url", "")
        if not influxdb_url:
            return JsonResponse({"configured": False})

        influxdb_token    = CONFIG.get("influxdb_token", "")
        influxdb_org      = CONFIG.get("influxdb_org", "")
        influxdb_bucket   = CONFIG.get("influxdb_bucket", "")
        influxdb_database = CONFIG.get("influxdb_database", "")
        measurement       = CONFIG.get("influxdb_measurement", "cpu_value")
        host_tag          = CONFIG.get("influxdb_host_tag", "host")
        idle_instance     = CONFIG.get("influxdb_cpu_idle_instance", "idle")
        stale_minutes     = int(CONFIG.get("influxdb_stale_minutes", 15))

        try:
            import requests as _req
            metrics: dict = {}

            if influxdb_token:
                # InfluxDB 2.x — Flux
                flux = (
                    f'from(bucket: "{influxdb_bucket}")'
                    f'  |> range(start: -{stale_minutes}m)'
                    f'  |> filter(fn: (r) => r["_measurement"] == "{measurement}"'
                    f'       and r["type_instance"] == "{idle_instance}")'
                    f'  |> mean()'
                    f'  |> keep(columns: ["{host_tag}", "_value"])'
                )
                resp = _req.post(
                    f"{influxdb_url.rstrip('/')}/api/v2/query",
                    params={"org": influxdb_org},
                    headers={
                        "Authorization": f"Token {influxdb_token}",
                        "Content-Type": "application/vnd.flux",
                        "Accept":        "application/csv",
                    },
                    data=flux,
                    timeout=10,
                )
                resp.raise_for_status()

                header = host_col = value_col = None
                for line in resp.text.splitlines():
                    if not line or line.startswith("#"):
                        header = None
                        continue
                    parts = line.split(",")
                    if header is None:
                        header = parts
                        try:
                            host_col  = header.index(host_tag)
                            value_col = header.index("_value")
                        except ValueError:
                            continue
                        continue
                    if host_col is not None and value_col is not None:
                        h = parts[host_col].strip()  if host_col  < len(parts) else ""
                        v = parts[value_col].strip() if value_col < len(parts) else ""
                        if h and v:
                            try:
                                metrics[h] = {"cpu_pct": round(100 - float(v), 1)}
                            except ValueError:
                                pass
            else:
                # InfluxDB 1.x — InfluxQL
                q = (
                    f'SELECT mean(value) FROM "{measurement}" '
                    f'WHERE time > now() - {stale_minutes}m '
                    f'AND "type_instance" = \'{idle_instance}\' '
                    f'GROUP BY "{host_tag}"'
                )
                resp = _req.get(
                    f"{influxdb_url.rstrip('/')}/query",
                    params={"db": influxdb_database, "q": q, "epoch": "s"},
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()
                for result in data.get("results", []):
                    for series in result.get("series", []):
                        h    = series.get("tags", {}).get(host_tag, "")
                        vals = series.get("values", [])
                        if h and vals and vals[0][1] is not None:
                            metrics[h] = {"cpu_pct": round(100 - float(vals[0][1]), 1)}

            return JsonResponse({"configured": True, "metrics": metrics})

        except Exception:
            import traceback
            traceback.print_exc()
            return JsonResponse({"configured": True, "error": "Query failed", "metrics": {}})


class VulnerabilityView(PermissionRequiredMixin, View):
    """
    Returns vulnerability data per device, read from NetBox custom fields.
    Configure vuln_cf_score (CVSS 0-10 float) and/or vuln_cf_severity
    (critical/high/medium/low/none string) in PLUGINS_CONFIG to enable.
    Query: GET /plugins/netbox_topology_views/vulnerabilities/
    """
    permission_required = ("dcim.view_device",)

    def get(self, request):
        from django.http import JsonResponse
        score_cf    = CONFIG.get("vuln_cf_score", "")
        severity_cf = CONFIG.get("vuln_cf_severity", "")

        if not score_cf and not severity_cf:
            return JsonResponse({"configured": False})

        try:
            result: dict = {}
            for dev in Device.objects.values("name", "custom_field_data"):
                cf = dev.get("custom_field_data") or {}
                entry: dict = {}
                if score_cf and score_cf in cf and cf[score_cf] is not None:
                    try:
                        entry["score"] = float(cf[score_cf])
                    except (ValueError, TypeError):
                        pass
                if severity_cf and severity_cf in cf and cf[severity_cf] is not None:
                    entry["severity"] = str(cf[severity_cf]).lower()
                if entry:
                    result[dev["name"]] = entry

            return JsonResponse({"configured": True, "devices": result})

        except Exception:
            import traceback
            traceback.print_exc()
            return JsonResponse({"configured": True, "error": "Query failed", "devices": {}})


class AlertStatusView(PermissionRequiredMixin, View):
    """
    Proxy endpoint that queries InfluxDB/Collectd for device heartbeats and
    returns a JSON object listing hosts that reported recently.
    Used by the topology frontend for the real-time status colour overlay.
    """
    permission_required = ("dcim.view_device",)

    def get(self, request):
        from django.http import JsonResponse
        influxdb_url = CONFIG.get("influxdb_url", "")
        if not influxdb_url:
            return JsonResponse({"configured": False})

        influxdb_token    = CONFIG.get("influxdb_token", "")
        influxdb_org      = CONFIG.get("influxdb_org", "")
        influxdb_bucket   = CONFIG.get("influxdb_bucket", "")
        influxdb_database = CONFIG.get("influxdb_database", "")
        measurement       = CONFIG.get("influxdb_measurement", "cpu_value")
        host_tag          = CONFIG.get("influxdb_host_tag", "host")
        stale_minutes     = int(CONFIG.get("influxdb_stale_minutes", 15))

        try:
            import requests as _req

            if influxdb_token:
                # InfluxDB 2.x — Flux query returns active hosts as CSV
                flux = (
                    f'from(bucket: "{influxdb_bucket}")'
                    f'  |> range(start: -{stale_minutes}m)'
                    f'  |> filter(fn: (r) => r["_measurement"] == "{measurement}")'
                    f'  |> keep(columns: ["{host_tag}"])'
                    f'  |> distinct(column: "{host_tag}")'
                )
                resp = _req.post(
                    f"{influxdb_url.rstrip('/')}/api/v2/query",
                    params={"org": influxdb_org},
                    headers={
                        "Authorization": f"Token {influxdb_token}",
                        "Content-Type": "application/vnd.flux",
                        "Accept":        "application/csv",
                    },
                    data=flux,
                    timeout=10,
                )
                resp.raise_for_status()

                active_hosts = set()
                header = None
                host_col = None
                for line in resp.text.splitlines():
                    if not line or line.startswith("#"):
                        header = None
                        continue
                    parts = line.split(",")
                    if header is None:
                        header = parts
                        try:
                            host_col = header.index(host_tag)
                        except ValueError:
                            # Column might be last or unnamed — fall back to last
                            host_col = len(parts) - 1
                        continue
                    if host_col is not None and host_col < len(parts):
                        h = parts[host_col].strip()
                        if h:
                            active_hosts.add(h)
            else:
                # InfluxDB 1.x — InfluxQL
                influxql = (
                    f'SELECT last(value) FROM "{measurement}" '
                    f'WHERE time > now() - {stale_minutes}m '
                    f'GROUP BY "{host_tag}"'
                )
                resp = _req.get(
                    f"{influxdb_url.rstrip('/')}/query",
                    params={"db": influxdb_database, "q": influxql, "epoch": "s"},
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()
                active_hosts = set()
                for result in data.get("results", []):
                    for series in result.get("series", []):
                        h = series.get("tags", {}).get(host_tag, "")
                        if h:
                            active_hosts.add(h)

            return JsonResponse({
                "configured":   True,
                "active_hosts": list(active_hosts),
                "stale_minutes": stale_minutes,
            })

        except Exception:
            import traceback
            traceback.print_exc()
            return JsonResponse({"configured": True, "error": "Query failed"})


class TopologyHomeView(PermissionRequiredMixin, View):
    permission_required = ("dcim.view_site", "dcim.view_device")

    """
    Show the home page
    """

    def get(self, request):
        self.filterset = DeviceFilterSet
        self.queryset = Device.objects.restrict(request.user, 'view').select_related(
            "device_type", "role"
        )
        self.queryset = self.filterset(request.GET, self.queryset).qs
        self.model = self.queryset.model
        topo_data = None

        individualOptions, created = IndividualOptions.objects.get_or_create(
            user_id=request.user.id,
        )

        if request.GET:

            filter_id, ignore_cable_type, save_coords, show_unconnected, show_power, show_circuit, show_logical_connections, show_single_cable_logical_conns, show_cables, show_wireless, group_sites, group_locations, group_racks, group_virtualchassis, group, show_neighbors, straight_cables, draw_termination_labels, draw_cable_labels, grid_size, node_label_items, show_arp_neighbors, show_l3_topology, show_virtual_machines = get_query_settings(request)
            
            filter_required = True
            empty_result = False
            
            # Read options from saved filters as NetBox does not handle custom plugin filters
            if "filter_id" in request.GET and request.GET["filter_id"] != '':
                try:
                    saved_filter = SavedFilter.objects.get(pk=filter_id)
                    saved_filter_params = getattr(saved_filter, 'parameters')

                    if ignore_cable_type == () and 'ignore_cable_type' in saved_filter_params: ignore_cable_type = saved_filter_params['ignore_cable_type']
                    if save_coords == False and 'save_coords' in saved_filter_params: save_coords = saved_filter_params['save_coords']
                    if show_unconnected == False and 'show_unconnected' in saved_filter_params: show_unconnected = saved_filter_params['show_unconnected']
                    if show_power == False and 'show_power' in saved_filter_params: show_power = saved_filter_params['show_power']
                    if show_circuit == False and 'show_circuit' in saved_filter_params: show_circuit = saved_filter_params['show_circuit']
                    if show_logical_connections == False and 'show_logical_connections' in saved_filter_params: show_logical_connections = saved_filter_params['show_logical_connections']
                    if show_single_cable_logical_conns == False and 'show_single_cable_logical_conns' in saved_filter_params: show_single_cable_logical_conns = saved_filter_params['show_single_cable_logical_conns']
                    if show_cables == False and 'show_cables' in saved_filter_params: show_cables = saved_filter_params['show_cables']
                    if show_wireless == False and 'show_wireless' in saved_filter_params: show_wireless = saved_filter_params['show_wireless']
                    if group_sites == False and 'group_sites' in saved_filter_params: group_sites = saved_filter_params['group_sites']
                    if group_locations == False and 'group_locations' in saved_filter_params: group_locations = saved_filter_params['group_locations']
                    if group_racks == False and 'group_racks' in saved_filter_params: group_racks = saved_filter_params['group_racks']
                    if group_virtualchassis == False and 'group_virtualchassis' in saved_filter_params: group_virtualchassis = saved_filter_params['group_virtualchassis']
                    if show_neighbors == False and 'show_neighbors' in saved_filter_params: show_neighbors = saved_filter_params['show_neighbors']
                    if straight_cables == False and 'straight_cables' in saved_filter_params: straight_cables = saved_filter_params['straight_cables']
                    if draw_termination_labels == False and 'draw_termination_labels' in saved_filter_params: draw_termination_labels = saved_filter_params['draw_termination_labels']
                    if draw_cable_labels == False and 'draw_cable_labels' in saved_filter_params: draw_cable_labels = saved_filter_params['draw_cable_labels']
                    if grid_size == 0 and 'grid_size' in saved_filter_params: grid_size = saved_filter_params['grid_size']
                    if node_label_items == () and 'node_label_items' in saved_filter_params: node_label_items = saved_filter_params['node_label_items']
                    if show_arp_neighbors == False and 'show_arp_neighbors' in saved_filter_params: show_arp_neighbors = saved_filter_params['show_arp_neighbors']
                    if show_l3_topology == False and 'show_l3_topology' in saved_filter_params: show_l3_topology = saved_filter_params['show_l3_topology']
                    if show_virtual_machines == False and 'show_virtual_machines' in saved_filter_params: show_virtual_machines = saved_filter_params['show_virtual_machines']
                except SavedFilter.DoesNotExist: # filter_id not found
                    pass
                except Exception as inst:
                    print(type(inst))

            if "group" not in request.GET:
                if 'saved_filter_params' in locals() and "group" in saved_filter_params:
                    group_id = saved_filter_params['group'][0]
                else:
                    group_id = "default"
            else:
                group_id = request.GET["group"]

            if not "draw_init" in request.GET or "draw_init" in request.GET and request.GET["draw_init"].lower() == "true":
                filter_required = False

                topo_data = get_topology_data(
                    queryset=self.queryset,
                    individualOptions=individualOptions,
                    ignore_cable_type=ignore_cable_type,
                    save_coords=save_coords,
                    show_unconnected=show_unconnected,
                    show_cables=show_cables,
                    show_logical_connections=show_logical_connections,
                    show_single_cable_logical_conns=show_single_cable_logical_conns,
                    show_neighbors=show_neighbors,
                    show_circuit=show_circuit,
                    show_power=show_power,
                    show_wireless=show_wireless,
                    group_sites=group_sites,
                    group_locations=group_locations,
                    group_racks=group_racks,
                    group_virtualchassis=group_virtualchassis,
                    group_id=group_id,
                    straight_cables=straight_cables,
                    draw_termination_labels=draw_termination_labels,
                    draw_cable_labels=draw_cable_labels,
                    grid_size=grid_size,
                    node_label_items=node_label_items,
                    show_arp_neighbors=show_arp_neighbors,
                    show_l3_topology=show_l3_topology,
                    show_virtual_machines=show_virtual_machines,
                )

                if topo_data is None or not topo_data["nodes"]:
                    empty_result = True
            
        else:
            # No GET-Request in URL. We most likely came here from the navigation menu.
            preselected_device_roles = IndividualOptions.objects.get(id=individualOptions.id).preselected_device_roles.all().values_list('id', flat=True)
            preselected_tags = IndividualOptions.objects.get(id=individualOptions.id).preselected_tags.all().values_list('slug', flat=True)
            ignore_cable_type = IndividualOptions.objects.get(id=individualOptions.id).ignore_cable_type.translate({ord(i): None for i in '[]\''}).split(', ')
            if ignore_cable_type == ['']: ignore_cable_type = []

            q = QueryDict(mutable=True)
            q.setlist("role_id", list(preselected_device_roles))
            q.setlist("tag", list(preselected_tags))
            q.setlist("ignore_cable_type", ignore_cable_type)

            if individualOptions.save_coords: q['save_coords'] = "True"
            if individualOptions.show_unconnected: q['show_unconnected'] = "True"
            if individualOptions.show_cables: q['show_cables'] = "True"
            if individualOptions.show_logical_connections: q['show_logical_connections'] = "True"
            if individualOptions.show_single_cable_logical_conns: q['show_single_cable_logical_conns'] = "True"
            if individualOptions.show_neighbors: q['show_neighbors'] = "True"
            if individualOptions.show_circuit: q['show_circuit'] = "True"
            if individualOptions.show_power: q['show_power'] = "True"
            if individualOptions.show_wireless: q['show_wireless'] = "True"
            if individualOptions.group_sites: q['group_sites'] = "True"
            if individualOptions.group_locations: q['group_locations'] = "True"
            if individualOptions.group_racks: q['group_racks'] = "True"
            if individualOptions.group_virtualchassis: q['group_virtualchassis'] = "True"
            if individualOptions.straight_cables: q['straight_cables'] = "True"
            if individualOptions.draw_termination_labels: q['draw_termination_labels'] = "True"
            if individualOptions.draw_cable_labels: q['draw_cable_labels'] = "True"
            if individualOptions.show_arp_neighbors: q['show_arp_neighbors'] = "True"
            if individualOptions.show_l3_topology: q['show_l3_topology'] = "True"
            if individualOptions.show_virtual_machines: q['show_virtual_machines'] = "True"
            if individualOptions.grid_size: q['grid_size'] = individualOptions.grid_size
            node_label_items = IndividualOptions.objects.get(id=individualOptions.id).node_label_items.translate({ord(i): None for i in '[]\''}).split(', ')
            if node_label_items == ['']: node_label_items = []
            q.setlist("node_label_items", node_label_items)

            if individualOptions.draw_default_layout: 
                q['draw_init'] = "True"
            else:
                q['draw_init'] = "False"

            query_string = q.urlencode()
            return HttpResponseRedirect(f"{request.path}?{query_string}")

        return render(
            request,
            "netbox_topology_views/index.html",
            {
                "filter_form": DeviceFilterForm(request.GET, label_suffix=""),
                "topology_data": json.dumps(topo_data),
                "broken_image": find_image_url("role-unknown"),
                "model": self.model,
                "basepath": settings.BASE_PATH,
                "filter_required": filter_required,
                "empty_result": empty_result,
            },
        )


CONFIG = settings.PLUGINS_CONFIG["netbox_topology_views"]
ADDITIONAL_ROLES = (PowerPanel, PowerFeed, Circuit)


# ---------------------------------------------------------------------------
# IP / Routing Topology
# ---------------------------------------------------------------------------

_IP_PALETTE = [
    '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336',
    '#00BCD4', '#8BC34A', '#FF5722', '#3F51B5', '#E91E63',
    '#009688', '#795548', '#607D8B', '#FF4081', '#1565C0',
]

import ipaddress as _ipaddr_module

_PRIVATE_NETS = [
    _ipaddr_module.ip_network('10.0.0.0/8'),
    _ipaddr_module.ip_network('172.16.0.0/12'),
    _ipaddr_module.ip_network('192.168.0.0/16'),
    _ipaddr_module.ip_network('100.64.0.0/10'),
    _ipaddr_module.ip_network('169.254.0.0/16'),
    _ipaddr_module.ip_network('127.0.0.0/8'),
    _ipaddr_module.ip_network('fc00::/7'),
    _ipaddr_module.ip_network('fe80::/10'),
    _ipaddr_module.ip_network('::1/128'),
]


def _is_private_net(net):
    for priv in _PRIVATE_NETS:
        try:
            if net.version == priv.version and (net.subnet_of(priv) or net == priv):
                return True
        except Exception:
            pass
    return False


def _hash_color(s):
    h = 0
    for c in str(s):
        h = (31 * h + ord(c)) & 0xFFFFFFFF
    return _IP_PALETTE[h % len(_IP_PALETTE)]


def _spring_for_prefix(prefixlen, family):
    """Shorter spring for more specific (smaller) subnets — devices cluster closer."""
    max_plen = 32 if family == 4 else 128
    return max(50, int(380 - (prefixlen / max_plen) * 320))


_VULN_SEV_WEIGHTS = {'critical': 5, 'high': 4, 'medium': 3, 'low': 2, 'info': 1, 'none': 0}
_VULN_SEV_COLORS  = {
    'critical': '#D32F2F',
    'high':     '#F57C00',
    'medium':   '#F9A825',
    'low':      '#1976D2',
    'info':     '#9E9E9E',
}


def get_ip_topology_data(request):
    """Build topology nodes/edges from IP assignments, prefixes, ASNs, and L2 VLANs.

    Physics design:
    - "The Internet" node is pinned at the origin.
    - Public prefix nodes spring toward Internet / their ASN node.
    - LAN (private) prefix nodes have no Internet spring, so physics repels them
      outward — sites naturally cluster together and push apart from each other.
    """
    from ipam.models import IPAddress, Prefix, VRF

    vrf_id            = request.GET.get('vrf_id')  or None
    site_id           = request.GET.get('site_id') or None
    show_hosts        = request.GET.get('show_hosts', '')         == 'on'
    show_prefix_edges = request.GET.get('show_prefix_edges', '')  == 'on'
    show_internet     = request.GET.get('show_internet', 'on')    == 'on'
    show_asns         = request.GET.get('show_asns', 'on')        == 'on'
    show_l2           = request.GET.get('show_l2', '')            == 'on'
    show_vulns        = request.GET.get('show_vulns', 'on')       == 'on'
    show_mac_adj      = request.GET.get('show_mac_adj', '')       == 'on'
    geo_seed          = request.GET.get('geo_seed', '')           == 'on'

    # --- Prefixes ---
    # NetBox 4.x renamed the direct site FK to _site / _site_id on Prefix.
    _pfx_has_underscore_site = any(
        f.name == '_site' for f in Prefix._meta.get_fields()
    )
    _pfx_site_related = '_site' if _pfx_has_underscore_site else 'site'
    _pfx_site_filter  = '_site_id' if _pfx_has_underscore_site else 'site_id'

    prefix_qs = Prefix.objects.select_related(
        'vrf', _pfx_site_related, 'role', 'tenant'
    ).order_by('prefix')
    if vrf_id:
        prefix_qs = prefix_qs.filter(vrf_id=vrf_id)
    if site_id:
        prefix_qs = prefix_qs.filter(**{_pfx_site_filter: site_id})

    prefixes = list(prefix_qs)
    if not show_hosts:
        prefixes = [p for p in prefixes if not (
            (p.family == 4 and p.prefix.prefixlen >= 32) or
            (p.family == 6 and p.prefix.prefixlen >= 128)
        )]

    nodes     = []
    edges     = []
    edge_id   = 0
    prefix_node_ids  = {}
    prefix_is_public = {}

    # Build prefix-net list first for public/private classification
    prefix_nets = []
    for p in prefixes:
        try:
            net = _ipaddr_module.ip_network(str(p.prefix), strict=False)
            prefix_nets.append((p.pk, net, p.vrf_id, p.family))
            prefix_is_public[p.pk] = not _is_private_net(net)
        except Exception:
            prefix_is_public[p.pk] = False

    has_public_prefixes = any(prefix_is_public.values())

    # ── ASN nodes ────────────────────────────────────────────────────────────
    asn_node_ids = {}
    site_asns    = {}
    if show_asns:
        try:
            from ipam.models import ASN as NetBoxASN
            for asn_obj in NetBoxASN.objects.prefetch_related('sites').all():
                asn_nid = f"asn_{asn_obj.pk}"
                label   = f"AS{asn_obj.asn}"
                if asn_obj.description:
                    label += f"\n{asn_obj.description[:30]}"
                nodes.append({
                    "id":      asn_nid,
                    "label":   label,
                    "shape":   "text",
                    "font":    {"size": 13, "bold": True, "color": "#E65100"},
                    "href":    asn_obj.get_absolute_url(),
                    "title":   f"<b>AS{asn_obj.asn}</b><br>{asn_obj.description or ''}",
                    "physics": True,
                    "x": 0, "y": 0,
                    "is_asn":  True,
                    "asn_num": str(asn_obj.asn),
                })
                asn_node_ids[asn_obj.pk] = asn_nid
                for site in asn_obj.sites.all():
                    site_asns.setdefault(site.pk, []).append(asn_obj.pk)
        except (ImportError, Exception):
            pass

    # ── Internet node (pinned at origin) ─────────────────────────────────────
    internet_id = "internet"
    if show_internet and (has_public_prefixes or asn_node_ids):
        nodes.insert(0, {
            "id":      internet_id,
            "label":   "The Internet",
            "shape":   "text",
            "font":    {"size": 15, "bold": True, "color": "#1565C0"},
            "physics": False,
            "x": 0, "y": 0,
            "fixed":   {"x": True, "y": True},
            "title":   "<b>The Internet</b><br>Public IP space",
            "is_internet": True,
        })
        # ASN → Internet edges
        for asn_pk, asn_nid in asn_node_ids.items():
            edge_id += 1
            edges.append({
                "id":     edge_id,
                "from":   asn_nid,
                "to":     internet_id,
                "length": 200,
                "color":  {"color": "#FF9800", "opacity": 0.7},
                "width":  2,
                "dashes": [6, 3],
                "smooth": {"type": "dynamic"},
                "title":  "Upstream to Internet",
                "is_wan": True,
            })

    # ── Prefix nodes ──────────────────────────────────────────────────────────
    for p in prefixes:
        node_id  = f"pfx_{p.pk}"
        prefix_node_ids[p.pk] = node_id
        is_pub   = prefix_is_public.get(p.pk, False)

        vrf_key  = str(p.vrf_id) if p.vrf_id else "global"
        vrf_name = p.vrf.name if p.vrf else "Global"
        p_site   = p._site if _pfx_has_underscore_site else p.site
        color    = "#1565C0" if is_pub else _hash_color(vrf_key)

        plen     = p.prefix.prefixlen
        family   = p.family
        max_plen = 32 if family == 4 else 128
        node_size = max(18, int(60 - (plen / max_plen) * 42))

        label_lines = [str(p.prefix)]
        if p.description:
            label_lines.append(p.description[:35])
        if p.vrf:
            label_lines.append(f"VRF: {vrf_name}")
        if is_pub:
            label_lines.append("WAN / Public")

        nodes.append({
            "id":        node_id,
            "label":     "\n".join(label_lines),
            "shape":     "text",
            "font":      {"size": 11, "color": color, "bold": True},
            "href":       p.get_absolute_url(),
            "title":      (
                f"<b>{p.prefix}</b><br>"
                f"Type: {'Public / WAN' if is_pub else 'Private / LAN'}<br>"
                f"VRF: {vrf_name}<br>"
                f"Status: {p.status}<br>"
                f"Description: {p.description or '—'}<br>"
                f"Site: {p_site or '—'}"
            ),
            "physics":    True,
            "x": 0, "y": 0,
            "vrf_key":    vrf_key,
            "vrf_name":   vrf_name,
            "prefix_len": plen,
            "family":     family,
            "site_id":    p._site_id if _pfx_has_underscore_site else p.site_id,
            "site_name":  str(p_site) if p_site else None,
            "is_prefix":  True,
            "is_public":  is_pub,
        })

        # Public prefix → ASN or directly → Internet
        if show_internet and is_pub and (has_public_prefixes or asn_node_ids):
            target_id    = internet_id
            edge_color   = "#1565C0"
            _p_site_id = p._site_id if _pfx_has_underscore_site else p.site_id
            if show_asns and _p_site_id and _p_site_id in site_asns:
                asn_pk     = site_asns[_p_site_id][0]
                target_id  = asn_node_ids[asn_pk]
                edge_color = "#FF9800"
            edge_id += 1
            edges.append({
                "id":     edge_id,
                "from":   node_id,
                "to":     target_id,
                "length": _spring_for_prefix(plen, family) + 100,
                "color":  {"color": edge_color, "opacity": 0.55},
                "width":  2,
                "smooth": {"type": "dynamic"},
                "title":  f"{p.prefix} → Internet",
                "is_wan": True,
            })

    # ── IPs on device interfaces ───────────────────────────────────────────────
    interface_ct = ContentType.objects.get_for_model(Interface)
    ip_qs = (
        IPAddress.objects
        .filter(assigned_object_type=interface_ct, assigned_object_id__isnull=False)
        .select_related('vrf')
    )
    if vrf_id:
        ip_qs = ip_qs.filter(vrf_id=vrf_id)

    iface_ids = list(ip_qs.values_list('assigned_object_id', flat=True).distinct())
    ifaces_by_id = {
        iface.pk: iface
        for iface in Interface.objects.select_related(
            'device__role', 'device__site', 'device__device_type'
        ).filter(pk__in=iface_ids)
    }

    device_node_ids = {}
    connected_edges  = set()

    def _best_prefix(ip_addr_obj, vrf_id_val):
        best_pk = None; best_plen = -1
        for pfx_pk, pfx_net, pfx_vrf_id, _ in prefix_nets:
            if pfx_vrf_id != vrf_id_val:
                continue
            try:
                if ip_addr_obj in pfx_net and pfx_net.prefixlen > best_plen:
                    best_plen = pfx_net.prefixlen; best_pk = pfx_pk
            except Exception:
                continue
        return best_pk, best_plen

    for ip in ip_qs:
        iface = ifaces_by_id.get(ip.assigned_object_id)
        if iface is None or iface.device is None:
            continue
        device = iface.device
        try:
            ip_addr = _ipaddr_module.ip_address(str(ip.address.ip))
        except Exception:
            continue

        best_pk, best_plen = _best_prefix(ip_addr, ip.vrf_id)
        pfx_node_id = prefix_node_ids.get(best_pk) if best_pk else None

        dev_pk = device.pk
        if dev_pk not in device_node_ids:
            dev_id     = f"dev_{dev_pk}"
            dev_image  = find_image_url(device.role.slug if device.role else "role-unknown")
            role_color = "#" + (device.role.color if device.role and device.role.color else "6c757d")
            nodes.append({
                "id":            dev_id,
                "label":         device.name or f"Device {dev_pk}",
                "name":          device.name,
                "shape":         "image",
                "image":         dev_image,
                "size":          25,
                "href":          device.get_absolute_url(),
                "title":         (
                    f"<b>{device.name}</b><br>"
                    f"Site: {device.site}<br>"
                    f"Role: {device.role}<br>"
                    f"Status: {device.status}"
                ),
                "physics":       True,
                "x": 0, "y": 0,
                "color":         {"border": role_color},
                "device_status": device.status,
                "site_id":       device.site_id,
                "site_name":     str(device.site) if device.site else None,
                "is_device":     True,
            })
            device_node_ids[dev_pk] = dev_id

        dev_node_id = device_node_ids[dev_pk]
        if pfx_node_id is None:
            continue

        edge_key = (dev_node_id, pfx_node_id)
        if edge_key not in connected_edges:
            connected_edges.add(edge_key)
            edge_id += 1
            is_pub = prefix_is_public.get(best_pk, False)
            edges.append({
                "id":     edge_id,
                "from":   dev_node_id,
                "to":     pfx_node_id,
                "length": _spring_for_prefix(best_plen, ip_addr.version),
                "color":  {"color": "#1565C0" if is_pub else "#999999", "opacity": 0.55},
                "width":  1,
                "smooth": {"type": "dynamic"},
                "title":  str(ip.address),
                "label":  str(ip.address),
                "font":   {"size": 9, "color": "#777"},
                "is_wan": is_pub,
            })

    # ── IPs on VM interfaces ───────────────────────────────────────────────────
    vm_node_ids = {}
    try:
        from virtualization.models import VMInterface
        vm_iface_ct = ContentType.objects.get_for_model(VMInterface)
        vm_ip_qs = (
            IPAddress.objects
            .filter(assigned_object_type=vm_iface_ct, assigned_object_id__isnull=False)
            .select_related('vrf')
        )
        if vrf_id:
            vm_ip_qs = vm_ip_qs.filter(vrf_id=vrf_id)

        vm_iface_ids = list(vm_ip_qs.values_list('assigned_object_id', flat=True).distinct())
        vm_ifaces_by_id = {
            vi.pk: vi
            for vi in VMInterface.objects.select_related(
                'virtual_machine__role', 'virtual_machine__site'
            ).filter(pk__in=vm_iface_ids)
        }

        for ip in vm_ip_qs:
            vi = vm_ifaces_by_id.get(ip.assigned_object_id)
            if vi is None or vi.virtual_machine is None:
                continue
            vm = vi.virtual_machine
            try:
                ip_addr = _ipaddr_module.ip_address(str(ip.address.ip))
            except Exception:
                continue

            best_pk, best_plen = _best_prefix(ip_addr, ip.vrf_id)
            pfx_node_id = prefix_node_ids.get(best_pk) if best_pk else None

            vm_pk = vm.pk
            if vm_pk not in vm_node_ids:
                vm_id    = f"vmip_{vm_pk}"
                vm_image = find_image_url(vm.role.slug if vm.role else "virtual-machine")
                nodes.append({
                    "id":      vm_id,
                    "label":   vm.name,
                    "name":    vm.name,
                    "shape":   "image",
                    "image":   vm_image,
                    "size":    20,
                    "href":    vm.get_absolute_url(),
                    "title":   f"<b>{vm.name}</b><br>Virtual Machine",
                    "physics": True,
                    "x": 0, "y": 0,
                    "color":   {"border": "#4CAF50"},
                    "site_id": vm.site_id,
                    "is_vm":   True,
                })
                vm_node_ids[vm_pk] = vm_id

            vm_node_id = vm_node_ids[vm_pk]
            if pfx_node_id is None:
                continue

            edge_key = (vm_node_id, pfx_node_id)
            if edge_key not in connected_edges:
                connected_edges.add(edge_key)
                edge_id += 1
                edges.append({
                    "id":     edge_id,
                    "from":   vm_node_id,
                    "to":     pfx_node_id,
                    "length": _spring_for_prefix(best_plen, ip_addr.version),
                    "color":  {"color": "#4CAF50", "opacity": 0.5},
                    "width":  1,
                    "smooth": {"type": "dynamic"},
                    "title":  str(ip.address),
                    "label":  str(ip.address),
                    "font":   {"size": 9, "color": "#777"},
                })
    except Exception:
        pass

    # ── Vulnerability flags ───────────────────────────────────────────────────
    if show_vulns and (device_node_ids or vm_node_ids):
        try:
            from netbox_vuln_manager.models import VulnerabilityFinding
            from netbox_vuln_manager.choices import FindingStatusChoices
            from dcim.models import Device as _DcimDevice
            from virtualization.models import VirtualMachine as _VM

            dev_ct = ContentType.objects.get_for_model(_DcimDevice)
            vm_ct  = ContentType.objects.get_for_model(_VM)
            active_statuses = [FindingStatusChoices.OPEN, FindingStatusChoices.IN_PROGRESS]

            findings_qs = (
                VulnerabilityFinding.objects
                .filter(status__in=active_statuses)
                .filter(
                    Q(asset_type=dev_ct, asset_id__in=list(device_node_ids.keys())) |
                    Q(asset_type=vm_ct,  asset_id__in=list(vm_node_ids.keys()))
                )
                .values('asset_type_id', 'asset_id', 'severity', 'vulnerability__name')
            )

            asset_findings = {}
            for f in findings_qs:
                key = (f['asset_type_id'], f['asset_id'])
                asset_findings.setdefault(key, []).append(
                    (f['severity'], f['vulnerability__name'] or '')
                )

            if asset_findings:
                node_by_id = {n['id']: n for n in nodes}

                def _apply_vuln(node, findings_list):
                    worst_sev = max(findings_list, key=lambda x: _VULN_SEV_WEIGHTS.get(x[0], 0))[0]
                    count     = len(findings_list)
                    sev_color = _VULN_SEV_COLORS.get(worst_sev, '#9E9E9E')
                    node['vuln_severity'] = worst_sev
                    node['vuln_count']    = count
                    node['color']['border'] = sev_color
                    node['borderWidth']     = 4
                    sample    = [f[1] for f in findings_list[:5] if f[1]]
                    vuln_html = ''.join(f'<br>&#8226; {v}' for v in sample)
                    if count > 5:
                        vuln_html += f'<br>&#8226; &hellip; and {count - 5} more'
                    node['title'] += (
                        "<br><hr style='margin:4px 0'>"
                        f"<b style='color:{sev_color}'>&#9888; {count} open "
                        f"vuln{'s' if count != 1 else ''} ({worst_sev.upper()})</b>"
                        + vuln_html
                    )

                for dev_pk, dev_nid in device_node_ids.items():
                    key = (dev_ct.pk, dev_pk)
                    if key in asset_findings:
                        node = node_by_id.get(dev_nid)
                        if node:
                            _apply_vuln(node, asset_findings[key])

                for vm_pk, vm_nid in vm_node_ids.items():
                    key = (vm_ct.pk, vm_pk)
                    if key in asset_findings:
                        node = node_by_id.get(vm_nid)
                        if node:
                            _apply_vuln(node, asset_findings[key])
        except Exception:
            pass

    # ── Layer 2: VLANs ───────────────────────────────────────────────────────
    vlan_node_ids = {}
    if show_l2:
        try:
            from ipam.models import VLAN
            vlan_qs = VLAN.objects.select_related('site', 'group', 'role')
            if site_id:
                vlan_qs = vlan_qs.filter(site_id=site_id)
            for vlan in vlan_qs:
                vlan_nid = f"vlan_{vlan.pk}"
                vlan_node_ids[vlan.pk] = vlan_nid
                site_key = str(vlan.site_id) if vlan.site_id else "nosite"
                color    = _hash_color(f"vlan_{site_key}")
                nodes.append({
                    "id":      vlan_nid,
                    "label":   f"VLAN {vlan.vid}" + (f" — {vlan.name}" if vlan.name else ""),
                    "shape":   "text",
                    "font":    {"size": 10, "color": color, "bold": True},
                    "href":    vlan.get_absolute_url(),
                    "title":   (
                        f"<b>VLAN {vlan.vid}</b><br>"
                        f"Name: {vlan.name or '—'}<br>"
                        f"Site: {vlan.site or '—'}<br>"
                        f"Status: {vlan.status}"
                    ),
                    "physics": True,
                    "x": 0, "y": 0,
                    "site_id": vlan.site_id,
                    "is_vlan": True,
                })
            # Device interface → VLAN memberships
            if device_node_ids:
                l2_ifaces = (
                    Interface.objects
                    .select_related('device')
                    .filter(device_id__in=list(device_node_ids.keys()))
                    .prefetch_related('tagged_vlans', 'untagged_vlan')
                )
                for iface in l2_ifaces:
                    dev_nid = device_node_ids.get(iface.device_id)
                    if not dev_nid:
                        continue
                    vlans_to_connect = list(iface.tagged_vlans.filter(pk__in=list(vlan_node_ids.keys())))
                    if iface.untagged_vlan and iface.untagged_vlan.pk in vlan_node_ids:
                        vlans_to_connect.append(iface.untagged_vlan)
                    for vlan in vlans_to_connect:
                        edge_key = (dev_nid, vlan_node_ids[vlan.pk])
                        if edge_key not in connected_edges:
                            connected_edges.add(edge_key)
                            edge_id += 1
                            vl_color = _hash_color(f"vlan_{vlan.site_id or 'nosite'}")
                            edges.append({
                                "id":     edge_id,
                                "from":   dev_nid,
                                "to":     vlan_node_ids[vlan.pk],
                                "length": 80,
                                "color":  {"color": vl_color, "opacity": 0.45},
                                "width":  1,
                                "dashes": [3, 4],
                                "smooth": {"type": "dynamic"},
                                "title":  f"VLAN {vlan.vid}: {iface.name}",
                                "is_l2":  True,
                            })
        except Exception:
            pass

    # ── Prefix → parent prefix routing edges ──────────────────────────────────
    if show_prefix_edges and len(prefix_nets) > 1:
        for i, (pk_a, net_a, vrf_a, fam_a) in enumerate(prefix_nets):
            best_parent = None
            best_plen   = -1
            for j, (pk_b, net_b, vrf_b, fam_b) in enumerate(prefix_nets):
                if i == j or vrf_a != vrf_b or fam_a != fam_b:
                    continue
                try:
                    if net_b.prefixlen < net_a.prefixlen and net_a.subnet_of(net_b):
                        if net_b.prefixlen > best_plen:
                            best_plen   = net_b.prefixlen
                            best_parent = pk_b
                except Exception:
                    continue
            if best_parent is not None:
                edge_id += 1
                edges.append({
                    "id":     edge_id,
                    "from":   prefix_node_ids[pk_a],
                    "to":     prefix_node_ids[best_parent],
                    "color":  {"color": "#cccccc", "opacity": 0.35},
                    "width":  1,
                    "dashes": [6, 4],
                    "smooth": {"type": "dynamic"},
                    "title":  "Parent prefix",
                    "length": _spring_for_prefix(best_plen, fam_a),
                })

    # ── Geographic coordinates ────────────────────────────────────────────────
    # Collect site lat/lon and attach to nodes; optionally seed initial positions.
    site_geo = {}
    try:
        from dcim.models import Site as _Site
        for s in _Site.objects.filter(latitude__isnull=False, longitude__isnull=False):
            site_geo[s.pk] = (float(s.latitude), float(s.longitude))
    except Exception:
        pass

    if site_geo:
        _all_lats = [v[0] for v in site_geo.values()]
        _all_lons = [v[1] for v in site_geo.values()]
        _lat_min  = min(_all_lats)
        _lon_min  = min(_all_lons)
        _lat_span = max(max(_all_lats) - _lat_min, 5.0)
        _lon_span = max(max(_all_lons) - _lon_min, 5.0)
        _CSPAN    = 2400

        def _geo_canvas(lat, lon):
            cx = int((lon - _lon_min) / _lon_span * _CSPAN - _CSPAN / 2)
            cy = int(-((lat - _lat_min) / _lat_span * _CSPAN - _CSPAN / 2))
            return cx, cy

        for node in nodes:
            sid = node.get('site_id')
            if sid and sid in site_geo:
                lat, lon = site_geo[sid]
                node['geo_lat'] = lat
                node['geo_lon'] = lon
                if geo_seed:
                    node['x'], node['y'] = _geo_canvas(lat, lon)

    # ── MAC adjacency (SNMP learned forwarding table) ─────────────────────────
    if show_mac_adj and device_node_ids:
        try:
            from netbox_snmp_sync.models import LearnedMAC
            from netbox_snmp_sync.choices import LearnedMACStatusChoices
            from dcim.models import Device as _DcimDevice, Interface as _DcimIface

            # Map device primary IP → device_pk
            dev_ip_map = {}
            for dev in _DcimDevice.objects.filter(
                pk__in=device_node_ids.keys()
            ).select_related('primary_ip4', 'primary_ip6'):
                if dev.primary_ip4:
                    dev_ip_map[str(dev.primary_ip4.address.ip)] = dev.pk
                if dev.primary_ip6:
                    dev_ip_map[str(dev.primary_ip6.address.ip)] = dev.pk

            if dev_ip_map:
                # Map Interface MAC → device_pk for devices in the graph
                mac_dev_map = {}
                for row in _DcimIface.objects.filter(
                    device_id__in=device_node_ids.keys(),
                    mac_address__isnull=False,
                ).exclude(mac_address='').values('device_id', 'mac_address'):
                    mac_dev_map[str(row['mac_address']).upper()] = row['device_id']

                active_statuses = [
                    LearnedMACStatusChoices.NEW,
                    LearnedMACStatusChoices.ACTIVE,
                    LearnedMACStatusChoices.PROMOTED,
                ]
                mac_adj_seen = set()
                for mac_entry in LearnedMAC.objects.filter(
                    source_device_ip__in=list(dev_ip_map.keys()),
                    status__in=active_statuses,
                    entry_type='learned',
                ).values('mac_address', 'source_device_ip', 'source_interface', 'last_seen'):
                    src_pk  = dev_ip_map.get(mac_entry['source_device_ip'])
                    if src_pk is None:
                        continue
                    tgt_pk  = mac_dev_map.get(str(mac_entry['mac_address']).upper())
                    if tgt_pk is None or tgt_pk == src_pk:
                        continue
                    src_nid = device_node_ids[src_pk]
                    tgt_nid = device_node_ids[tgt_pk]
                    key     = tuple(sorted([src_nid, tgt_nid]))
                    if key in mac_adj_seen:
                        continue
                    mac_adj_seen.add(key)
                    edge_id += 1
                    ts = mac_entry['last_seen']
                    edges.append({
                        "id":         edge_id,
                        "from":       src_nid,
                        "to":         tgt_nid,
                        "length":     60,
                        "color":      {"color": "#00897B", "opacity": 0.65},
                        "width":      2,
                        "dashes":     [4, 3],
                        "smooth":     {"type": "dynamic"},
                        "title":      (
                            f"<b>MAC adjacency</b><br>"
                            f"MAC: {mac_entry['mac_address']}<br>"
                            f"Port: {mac_entry['source_interface'] or '—'}<br>"
                            f"Last seen: {ts.strftime('%Y-%m-%d %H:%M') if ts else '—'}"
                        ),
                        "is_mac_adj": True,
                    })
        except Exception:
            pass

    # ── VRF legend metadata ─────────────────────────────────────────────────
    vrfs_seen = {}
    for p in prefixes:
        vk = str(p.vrf_id) if p.vrf_id else "global"
        if vk not in vrfs_seen:
            vrfs_seen[vk] = {"name": p.vrf.name if p.vrf else "Global", "color": _hash_color(vk)}

    return {
        "nodes":   nodes,
        "edges":   edges,
        "vrfs":    list(vrfs_seen.values()),
        "options": {
            "show_hosts":         show_hosts,
            "show_prefix_edges":  show_prefix_edges,
            "show_internet":      show_internet,
            "show_asns":          show_asns,
            "show_l2":            show_l2,
            "show_vulns":         show_vulns,
            "show_mac_adj":       show_mac_adj,
            "geo_seed":           geo_seed,
            "vrf_id":             vrf_id,
            "site_id":            site_id,
        },
    }


class IPTopologyView(PermissionRequiredMixin, View):
    """Physics-based topology derived from IP address assignments and prefix membership."""

    permission_required = ("dcim.view_device", "ipam.view_prefix", "ipam.view_ipaddress")

    def get(self, request):
        from ipam.models import VRF, Prefix
        from dcim.models import Site

        topo_data  = None
        topo_error = None
        if request.GET:
            try:
                topo_data = get_ip_topology_data(request)
            except Exception as exc:
                import traceback
                topo_error = traceback.format_exc()
                traceback.print_exc()

        vrfs   = VRF.objects.all().order_by('name')
        sites  = Site.objects.all().order_by('name')

        return render(request, "netbox_topology_views/ip_topology.html", {
            "topology_data":      json.dumps(topo_data),
            "topo_error":         topo_error,
            "broken_image":       find_image_url("role-unknown"),
            "basepath":           settings.BASE_PATH,
            "vrfs":               vrfs,
            "sites":              sites,
            "selected_vrf":       request.GET.get('vrf_id', ''),
            "selected_site":      request.GET.get('site_id', ''),
            "show_hosts":         request.GET.get('show_hosts', ''),
            "show_prefix_edges":  request.GET.get('show_prefix_edges', ''),
            "show_internet":      request.GET.get('show_internet', 'on'),
            "show_asns":          request.GET.get('show_asns', 'on'),
            "show_l2":            request.GET.get('show_l2', ''),
            "show_vulns":         request.GET.get('show_vulns', 'on'),
            "show_mac_adj":       request.GET.get('show_mac_adj', ''),
            "geo_seed":           request.GET.get('geo_seed', ''),
        })


def get_site_topology_data(request):
    from dcim.models import Site, Region

    region_id          = request.GET.get('region_id')  or None
    tenant_id          = request.GET.get('tenant_id')  or None
    show_circuits      = request.GET.get('show_circuits', 'on')     == 'on'
    show_regions       = request.GET.get('show_regions', 'on')      == 'on'
    show_device_counts = request.GET.get('show_device_counts', '')  == 'on'

    # ── Sites ─────────────────────────────────────────────────────────────
    site_qs = Site.objects.select_related('region', 'tenant', 'group').order_by('name')
    if region_id:
        try:
            root = Region.objects.get(pk=region_id)
            try:
                descendant_ids = root.get_descendants(include_self=True).values_list('pk', flat=True)
                site_qs = site_qs.filter(region_id__in=descendant_ids)
            except Exception:
                site_qs = site_qs.filter(region_id=region_id)
        except Region.DoesNotExist:
            pass
    if tenant_id:
        site_qs = site_qs.filter(tenant_id=tenant_id)

    sites = list(site_qs)
    nodes = []
    edges = []
    edge_id = 0

    # ── Region nodes ──────────────────────────────────────────────────────
    region_node_ids = {}
    if show_regions:
        regions_needed = {}
        for site in sites:
            r = site.region
            while r:
                if r.pk not in regions_needed:
                    regions_needed[r.pk] = r
                r = getattr(r, 'parent', None)

        for rpk, region in regions_needed.items():
            rid   = f"region_{rpk}"
            color = _hash_color(str(rpk))
            region_node_ids[rpk] = rid
            nodes.append({
                "id":     rid,
                "label":  region.name,
                "shape":  "text",
                "font":   {"size": 15, "bold": True, "color": color},
                "href":    region.get_absolute_url(),
                "title":   f"<b>{region.name}</b><br>Region",
                "physics": True,
                "x": 0, "y": 0,
                "is_region":        True,
                "parent_region_pk": getattr(region, 'parent_id', None),
            })

        # Region hierarchy edges
        for rpk, region in regions_needed.items():
            par_id = getattr(region, 'parent_id', None)
            if par_id and par_id in region_node_ids:
                edge_id += 1
                edges.append({
                    "id":     edge_id,
                    "from":   region_node_ids[rpk],
                    "to":     region_node_ids[par_id],
                    "length": 220,
                    "color":  {"color": "#aaa", "opacity": 0.4},
                    "width":  1,
                    "dashes": [4, 4],
                    "smooth": {"type": "dynamic"},
                    "title":  "Region hierarchy",
                    "is_hierarchy": True,
                })

    # ── Site nodes ────────────────────────────────────────────────────────
    STATUS_COLORS = {
        'active':          '#4CAF50',
        'planned':         '#2196F3',
        'staging':         '#FF9800',
        'decommissioning': '#F44336',
        'retired':         '#9E9E9E',
    }
    site_node_ids = {}
    for site in sites:
        sid    = f"site_{site.pk}"
        site_node_ids[site.pk] = sid
        border = STATUS_COLORS.get(site.status, '#607D8B')

        label = site.name
        if show_device_counts:
            dc    = site.devices.count()
            label += f"\n{dc} device{'s' if dc != 1 else ''}"

        nodes.append({
            "id":    sid,
            "label": label,
            "shape": "text",
            "font":  {"size": 12, "bold": True, "color": border},
            "href":  site.get_absolute_url(),
            "title": (
                f"<b>{site.name}</b><br>"
                f"Status: {site.status}<br>"
                f"Region: {site.region or '—'}<br>"
                f"Tenant: {site.tenant or '—'}"
            ),
            "physics":   True,
            "x": 0, "y": 0,
            "is_site":   True,
            "region_pk": site.region_id,
            "status":    site.status,
        })

        # Spring edge: site → parent region (drives the attraction physics)
        if show_regions and site.region_id and site.region_id in region_node_ids:
            edge_id += 1
            edges.append({
                "id":     edge_id,
                "from":   sid,
                "to":     region_node_ids[site.region_id],
                "length": 180,
                "color":  {"color": "#cccccc", "opacity": 0.35},
                "width":  1,
                "smooth": {"type": "dynamic"},
                "title":  f"{site.name} → {site.region}",
                "is_membership": True,
            })

    # ── Circuits ──────────────────────────────────────────────────────────
    circuit_count = 0
    if show_circuits and site_node_ids:
        try:
            from circuits.models import CircuitTermination
            terms = (
                CircuitTermination.objects
                .filter(site_id__in=list(site_node_ids.keys()))
                .select_related('circuit__type', 'circuit__provider', 'site')
            )
            by_circuit = {}
            for t in terms:
                by_circuit.setdefault(t.circuit_id, []).append(t)

            for cid, tlist in by_circuit.items():
                site_terms = [t for t in tlist if t.site_id in site_node_ids]
                if len(site_terms) < 2:
                    continue
                t_a, t_b = site_terms[0], site_terms[1]
                if t_a.site_id == t_b.site_id:
                    continue
                circuit = t_a.circuit
                edge_id += 1
                circuit_count += 1
                edges.append({
                    "id":     edge_id,
                    "from":   site_node_ids[t_a.site_id],
                    "to":     site_node_ids[t_b.site_id],
                    "length": 300,
                    "color":  {"color": "#1565C0", "opacity": 0.7},
                    "width":  2,
                    "smooth": {"type": "dynamic"},
                    "title":  (
                        f"<b>{circuit.cid}</b><br>"
                        f"Provider: {circuit.provider}<br>"
                        f"Type: {circuit.type}"
                    ),
                    "label":  circuit.type.name if circuit.type else "",
                    "font":   {"size": 9, "color": "#555"},
                    "href":   circuit.get_absolute_url(),
                    "is_circuit": True,
                })
        except Exception:
            import traceback
            traceback.print_exc()

    return {
        "nodes":         nodes,
        "edges":         edges,
        "circuit_count": circuit_count,
        "options": {
            "show_circuits":      show_circuits,
            "show_regions":       show_regions,
            "show_device_counts": show_device_counts,
        },
    }


class SiteTopologyView(PermissionRequiredMixin, View):
    """Physics-based topology derived from site and region relationships."""

    permission_required = ("dcim.view_site", "dcim.view_region")

    def get(self, request):
        from dcim.models import Region, Site
        from tenancy.models import Tenant

        topo_data  = None
        topo_error = None
        if request.GET:
            try:
                topo_data = get_site_topology_data(request)
            except Exception:
                import traceback
                topo_error = traceback.format_exc()
                traceback.print_exc()

        regions = Region.objects.all().order_by('name')
        tenants = Tenant.objects.all().order_by('name')

        return render(request, "netbox_topology_views/site_topology.html", {
            "topology_data":      json.dumps(topo_data),
            "topo_error":         topo_error,
            "broken_image":       find_image_url("role-unknown"),
            "basepath":           settings.BASE_PATH,
            "regions":            regions,
            "tenants":            tenants,
            "selected_region":    request.GET.get('region_id', ''),
            "selected_tenant":    request.GET.get('tenant_id', ''),
            "show_circuits":      request.GET.get('show_circuits', 'on'),
            "show_regions":       request.GET.get('show_regions', 'on'),
            "show_device_counts": request.GET.get('show_device_counts', ''),
        })


def get_l2_topology_data(request):
    from ipam.models import VLAN, VLANGroup
    from dcim.models import Site
    from django.db.models import Q

    site_id          = request.GET.get('site_id')       or None
    vlan_group_id    = request.GET.get('vlan_group_id') or None
    show_access      = request.GET.get('show_access',      'on') == 'on'
    show_trunks      = request.GET.get('show_trunks',      'on') == 'on'
    show_unconnected = request.GET.get('show_unconnected', '')   == 'on'

    # ── VLANs ────────────────────────────────────────────────────────────
    vlan_qs = VLAN.objects.select_related('site', 'group', 'tenant', 'role').order_by('vid')
    if site_id:
        vlan_qs = vlan_qs.filter(site_id=site_id)
    if vlan_group_id:
        vlan_qs = vlan_qs.filter(group_id=vlan_group_id)
    vlans    = list(vlan_qs)
    vlan_pks = {v.pk for v in vlans}
    if not vlan_pks:
        return {"nodes": [], "edges": [], "options": {}}

    # ── Interfaces referencing these VLANs ────────────────────────────────
    iface_qs = (
        Interface.objects
        .filter(Q(untagged_vlan_id__in=vlan_pks) | Q(tagged_vlans__in=vlan_pks))
        .select_related('device__role', 'device__site', 'device__device_type', 'untagged_vlan')
        .prefetch_related('tagged_vlans')
        .distinct()
    )
    if site_id:
        iface_qs = iface_qs.filter(device__site_id=site_id)
    interfaces = list(iface_qs)

    nodes      = []
    edges      = []
    edge_id    = 0
    seen_edges = set()

    # Determine which VLANs have at least one device
    vlan_connected = set()
    for iface in interfaces:
        if iface.untagged_vlan_id in vlan_pks:
            vlan_connected.add(iface.untagged_vlan_id)
        for tv in iface.tagged_vlans.all():
            if tv.pk in vlan_pks:
                vlan_connected.add(tv.pk)

    # ── VLAN nodes ────────────────────────────────────────────────────────
    vlan_node_ids = {}
    for vlan in vlans:
        if not show_unconnected and vlan.pk not in vlan_connected:
            continue
        nid   = f"vlan_{vlan.pk}"
        vlan_node_ids[vlan.pk] = nid
        color = _hash_color(str(vlan.group_id or vlan.site_id or 'global'))
        if vlan.status == 'reserved':
            color = '#FF9800'
        elif vlan.status == 'deprecated':
            color = '#9E9E9E'
        label = f"VLAN {vlan.vid}"
        if vlan.name:
            label += f" — {vlan.name}"
        nodes.append({
            "id":     nid,
            "label":  label,
            "shape":  "text",
            "font":   {"size": 11, "bold": True, "color": color},
            "href":         vlan.get_absolute_url(),
            "title":        (
                f"<b>VLAN {vlan.vid}</b> — {vlan.name or '(unnamed)'}<br>"
                f"Status: {vlan.status}<br>"
                f"Site: {vlan.site or 'Global'}<br>"
                f"Group: {vlan.group or '—'}"
            ),
            "physics":      True,
            "x": 0, "y": 0,
            "is_vlan":      True,
            "vid":          vlan.vid,
        })

    # ── Device nodes + membership edges ───────────────────────────────────
    device_node_ids = {}
    trunk_iface_pks = set()

    for iface in interfaces:
        device = iface.device
        if device.pk not in device_node_ids:
            dev_id     = f"dev_{device.pk}"
            role_color = "#" + (device.role.color if device.role and device.role.color else "6c757d")
            dev_image  = find_image_url(device.role.slug if device.role else "role-unknown")
            node = {
                "id":      dev_id,
                "label":   device.name or f"Device {device.pk}",
                "shape":   "image",
                "image":   dev_image,
                "size":    22,
                "color":   {"border": role_color},
                "font":    {"size": 11},
                "href":    device.get_absolute_url(),
                "title":   (
                    f"<b>{device.name}</b><br>"
                    f"Site: {device.site}<br>"
                    f"Role: {device.role}"
                ),
                "physics":   True,
                "x": 0, "y": 0,
                "is_device": True,
            }
            nodes.append(node)
            device_node_ids[device.pk] = dev_id

        dev_nid = device_node_ids[device.pk]

        # Access edge
        if show_access and iface.untagged_vlan_id in vlan_node_ids:
            vlan_nid  = vlan_node_ids[iface.untagged_vlan_id]
            ekey = (dev_nid, vlan_nid, 'access')
            if ekey not in seen_edges:
                seen_edges.add(ekey)
                edge_id += 1
                edges.append({
                    "id":       edge_id,
                    "from":     dev_nid,
                    "to":       vlan_nid,
                    "length":   120,
                    "color":    {"color": "#4CAF50", "opacity": 0.65},
                    "width":    1,
                    "smooth":   {"type": "dynamic"},
                    "title":    f"Access: {iface.name} → VLAN {iface.untagged_vlan.vid}",
                    "is_access": True,
                })

        # Tagged edges
        if show_trunks:
            for tv in iface.tagged_vlans.all():
                if tv.pk not in vlan_node_ids:
                    continue
                vlan_nid = vlan_node_ids[tv.pk]
                ekey = (dev_nid, vlan_nid, 'tagged')
                if ekey not in seen_edges:
                    seen_edges.add(ekey)
                    edge_id += 1
                    edges.append({
                        "id":      edge_id,
                        "from":    dev_nid,
                        "to":      vlan_nid,
                        "length":  150,
                        "color":   {"color": "#1565C0", "opacity": 0.55},
                        "width":   2,
                        "dashes":  [4, 3],
                        "smooth":  {"type": "dynamic"},
                        "title":   f"Tagged: {iface.name} → VLAN {tv.vid}",
                        "is_tagged": True,
                    })
            if iface.mode in ('tagged', 'tagged-all'):
                trunk_iface_pks.add(iface.pk)

    # ── Physical trunk cable edges ─────────────────────────────────────────
    if show_trunks and trunk_iface_pks:
        try:
            iface_ct = ContentType.objects.get_for_model(Interface)
            terms = (
                CableTermination.objects
                .filter(termination_type=iface_ct, termination_id__in=trunk_iface_pks)
                .select_related('cable')
            )
            by_cable = {}
            for t in terms:
                if t.cable_id:
                    by_cable.setdefault(t.cable_id, []).append(t.termination_id)

            iface_to_device = {iface.pk: iface.device_id for iface in interfaces}
            for cable_id, iface_ids in by_cable.items():
                if len(iface_ids) < 2:
                    continue
                dev_a = iface_to_device.get(iface_ids[0])
                dev_b = iface_to_device.get(iface_ids[1])
                if not dev_a or not dev_b or dev_a == dev_b:
                    continue
                if dev_a not in device_node_ids or dev_b not in device_node_ids:
                    continue
                pair = tuple(sorted([dev_a, dev_b]))
                if pair in seen_edges:
                    continue
                seen_edges.add(pair)
                edge_id += 1
                edges.append({
                    "id":           edge_id,
                    "from":         device_node_ids[dev_a],
                    "to":           device_node_ids[dev_b],
                    "length":       80,
                    "color":        {"color": "#FF6F00", "opacity": 0.85},
                    "width":        3,
                    "smooth":       {"type": "dynamic"},
                    "title":        "Physical trunk cable",
                    "is_trunk_link": True,
                })
        except Exception:
            import traceback; traceback.print_exc()

    return {
        "nodes": nodes,
        "edges": edges,
        "options": {
            "show_access":      show_access,
            "show_trunks":      show_trunks,
            "show_unconnected": show_unconnected,
        },
    }


class L2TopologyView(PermissionRequiredMixin, View):
    """Layer-2 topology derived from VLAN membership and trunk port relationships."""

    permission_required = ("dcim.view_device", "ipam.view_vlan")

    def get(self, request):
        from ipam.models import VLANGroup
        from dcim.models import Site

        topo_data  = None
        topo_error = None
        if request.GET:
            try:
                topo_data = get_l2_topology_data(request)
            except Exception:
                import traceback
                topo_error = traceback.format_exc()
                traceback.print_exc()

        sites       = Site.objects.all().order_by('name')
        vlan_groups = VLANGroup.objects.all().order_by('name')

        return render(request, "netbox_topology_views/l2_topology.html", {
            "topology_data":      json.dumps(topo_data),
            "topo_error":         topo_error,
            "broken_image":       find_image_url("role-unknown"),
            "basepath":           settings.BASE_PATH,
            "sites":              sites,
            "vlan_groups":        vlan_groups,
            "selected_site":      request.GET.get('site_id', ''),
            "selected_vlan_group":request.GET.get('vlan_group_id', ''),
            "show_access":        request.GET.get('show_access',      'on'),
            "show_trunks":        request.GET.get('show_trunks',      'on'),
            "show_unconnected":   request.GET.get('show_unconnected', ''),
        })


class TopologyImagesView(PermissionRequiredMixin, View):
    permission_required = (
        "dcim.view_site",
        "dcim.view_devicerole",
        "dcim.add_devicerole",
        "dcim.change_devicerole",
    )

    def get(self, request: HttpRequest):
        images = [
            {"url": image_static_url(image), "title": image.stem}
            for image in CONF_IMAGE_DIR.iterdir() if image.name.lower().endswith(IMAGE_FILETYPES)
        ]

        roles = reduce(
            lambda acc, cur: {
                **acc,
                cur.name: {
                    "id": cur.pk,
                    "name": cur.name,
                    "slug": cur.slug,
                    "image": find_image_url(cur.slug),
                },
            },
            DeviceRole.objects.all(),
            dict(),
        )

        for additional_role in ADDITIONAL_ROLES:
            cur = get_model_role(additional_role)
            ct = ContentType.objects.get_for_model(additional_role).pk

            roles[cur.name] = {
                "id": f"ct{ct}",
                "name": cur.name,
                "slug": cur.slug,
                "image": find_image_url(cur.slug),
            }

        role_images = RoleImage.objects.all()

        for role_image in role_images:
            roles[role_image.role.name]["image"] = role_image.get_image_url()

        return render(
            request,
            "netbox_topology_views/images.html",
            {
                "roles": sorted(list(roles.values()), key=lambda r: r["name"]),
                "images": images,
                "basepath": settings.BASE_PATH,
            },
        )

class CircuitCoordinateView(PermissionRequiredMixin, ObjectView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = CircuitCoordinate.objects.all()

class CircuitCoordinateAddView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.add_coordinate'

    queryset = CircuitCoordinate.objects.all()
    form = CircuitCoordinatesForm
    template_name = 'netbox_topology_views/circuitcoordinate_add.html'

class CircuitCoordinateBulkImportView(BulkImportView):
    queryset = CircuitCoordinate.objects.all()
    model_form = CircuitCoordinatesImportForm

class CircuitCoordinateListView(PermissionRequiredMixin, ObjectListView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = CircuitCoordinate.objects.all()
    table = CircuitCoordinateListTable
    template_name = 'netbox_topology_views/circuitcoordinate_list.html'
    filterset = CircuitCoordinatesFilterSet
    filterset_form = CircuitCoordinatesFilterForm

class CircuitCoordinateEditView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.change_coordinate'

    queryset = CircuitCoordinate.objects.all()
    form = CircuitCoordinatesForm
    template_name = 'netbox_topology_views/circuitcoordinate_edit.html'

class CircuitCoordinateDeleteView(PermissionRequiredMixin, ObjectDeleteView):
    permission_required = 'netbox_topology_views.delete_coordinate'

    queryset = CircuitCoordinate.objects.all()

class CircuitCoordinateChangeLogView(PermissionRequiredMixin, ObjectChangeLogView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = CircuitCoordinate.objects.all()

class PowerPanelCoordinateView(PermissionRequiredMixin, ObjectView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerPanelCoordinate.objects.all()

class PowerPanelCoordinateAddView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.add_coordinate'

    queryset = PowerPanelCoordinate.objects.all()
    form = PowerPanelCoordinatesForm
    template_name = 'netbox_topology_views/powerpanelcoordinate_add.html'

class PowerPanelCoordinateBulkImportView(BulkImportView):
    queryset = PowerPanelCoordinate.objects.all()
    model_form = PowerPanelCoordinatesImportForm

class PowerPanelCoordinateListView(PermissionRequiredMixin, ObjectListView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerPanelCoordinate.objects.all()
    table = PowerPanelCoordinateListTable
    template_name = 'netbox_topology_views/powerpanelcoordinate_list.html'
    filterset = PowerPanelCoordinatesFilterSet
    filterset_form = PowerPanelCoordinatesFilterForm

class PowerPanelCoordinateEditView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.change_coordinate'

    queryset = PowerPanelCoordinate.objects.all()
    form = PowerPanelCoordinatesForm
    template_name = 'netbox_topology_views/powerpanelcoordinate_edit.html'

class PowerPanelCoordinateDeleteView(PermissionRequiredMixin, ObjectDeleteView):
    permission_required = 'netbox_topology_views.delete_coordinate'

    queryset = PowerPanelCoordinate.objects.all()

class PowerPanelCoordinateChangeLogView(PermissionRequiredMixin, ObjectChangeLogView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerPanelCoordinate.objects.all()

class PowerFeedCoordinateView(PermissionRequiredMixin, ObjectView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerFeedCoordinate.objects.all()

class PowerFeedCoordinateAddView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.add_coordinate'

    queryset = PowerFeedCoordinate.objects.all()
    form = PowerFeedCoordinatesForm
    template_name = 'netbox_topology_views/powerfeedcoordinate_add.html'

class PowerFeedCoordinateBulkImportView(BulkImportView):
    queryset = PowerFeedCoordinate.objects.all()
    model_form = PowerFeedCoordinatesImportForm

class PowerFeedCoordinateListView(PermissionRequiredMixin, ObjectListView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerFeedCoordinate.objects.all()
    table = PowerFeedCoordinateListTable
    template_name = 'netbox_topology_views/powerfeedcoordinate_list.html'
    filterset = PowerFeedCoordinatesFilterSet
    filterset_form = PowerFeedCoordinatesFilterForm

class PowerFeedCoordinateEditView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.change_coordinate'

    queryset = PowerFeedCoordinate.objects.all()
    form = PowerFeedCoordinatesForm
    template_name = 'netbox_topology_views/powerfeedcoordinate_edit.html'

class PowerFeedCoordinateDeleteView(PermissionRequiredMixin, ObjectDeleteView):
    permission_required = 'netbox_topology_views.delete_coordinate'

    queryset = PowerFeedCoordinate.objects.all()

class PowerFeedCoordinateChangeLogView(PermissionRequiredMixin, ObjectChangeLogView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = PowerFeedCoordinate.objects.all()

class CoordinateView(PermissionRequiredMixin, ObjectView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = Coordinate.objects.all()

class CoordinateAddView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.add_coordinate'

    queryset = Coordinate.objects.all()
    form = CoordinatesForm
    template_name = 'netbox_topology_views/coordinate_add.html'

class CoordinateBulkImportView(BulkImportView):
    queryset = Coordinate.objects.all()
    model_form = CoordinatesImportForm

class CoordinateListView(PermissionRequiredMixin, ObjectListView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = Coordinate.objects.all()
    table = CoordinateListTable
    template_name = 'netbox_topology_views/coordinate_list.html'
    filterset = CoordinatesFilterSet
    filterset_form = CoordinatesFilterForm

class CoordinateEditView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.change_coordinate'

    queryset = Coordinate.objects.all()
    form = CoordinatesForm
    template_name = 'netbox_topology_views/coordinate_edit.html'

class CoordinateDeleteView(PermissionRequiredMixin, ObjectDeleteView):
    permission_required = 'netbox_topology_views.delete_coordinate'

    queryset = Coordinate.objects.all()

class CoordinateChangeLogView(PermissionRequiredMixin, ObjectChangeLogView):
    permission_required = 'netbox_topology_views.view_coordinate'

    queryset = Coordinate.objects.all()

class CoordinateGroupView(PermissionRequiredMixin, ObjectView):
    permission_required = 'netbox_topology_views.view_coordinategroup'

    queryset = CoordinateGroup.objects.all()

    def get_extra_context(self, request, instance):
        circuittable = CircuitCoordinateListTable(instance.circuitcoordinate_set.all())
        circuittable.configure(request)
        powerpaneltable = PowerPanelCoordinateListTable(instance.powerpanelcoordinate_set.all())
        powerpaneltable.configure(request)
        powerfeedtable = PowerFeedCoordinateListTable(instance.powerfeedcoordinate_set.all())
        powerfeedtable.configure(request)
        table = CoordinateListTable(instance.coordinate_set.all())
        table.configure(request)

        return {
            'circuitcoordinates_table': circuittable,
            'powerpanelcoordinates_table': powerpaneltable,
            'powerfeedcoordinates_table': powerfeedtable,
            'coordinates_table': table,
        }

class CoordinateGroupAddView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.add_coordinategroup'

    queryset = CoordinateGroup.objects.all()
    form = CoordinateGroupsForm
    template_name = 'netbox_topology_views/coordinategroup_add.html'

class CoordinateGroupBulkImportView(BulkImportView):
    queryset = CoordinateGroup.objects.all()
    model_form = CoordinateGroupsImportForm

class CoordinateGroupListView(PermissionRequiredMixin, ObjectListView):
    permission_required = 'netbox_topology_views.view_coordinategroup'

    queryset = CoordinateGroup.objects.annotate(
        devices = Count('coordinate')
    )
    table = CoordinateGroupListTable
    template_name = 'netbox_topology_views/coordinategroup_list.html'

class CoordinateGroupEditView(PermissionRequiredMixin, ObjectEditView):
    permission_required = 'netbox_topology_views.change_coordinategroup'

    queryset = CoordinateGroup.objects.all()
    form = CoordinateGroupsForm
    template_name = 'netbox_topology_views/coordinategroup_edit.html'

class CoordinateGroupDeleteView(PermissionRequiredMixin, ObjectDeleteView):
    permission_required = 'netbox_topology_views.delete_coordinategroup'

    queryset = CoordinateGroup.objects.all()

class CoordinateGroupChangeLogView(PermissionRequiredMixin, ObjectChangeLogView):
    permission_required = 'netbox_topology_views.view_coordinategroup'

    queryset = CoordinateGroup.objects.all()

class TopologyIndividualOptionsView(PermissionRequiredMixin, View):
    permission_required = 'netbox_topology_views.change_individualoptions'

    def post(self, request):
        instance = IndividualOptions.objects.get(user_id=request.user.id)
        form = IndividualOptionsForm(request.POST, instance=instance)
        if form.is_valid():
            form.save()
            messages.success(request, "Options have been sucessfully saved")
        else:
            messages.error(request, form.errors)
            
        return HttpResponseRedirect("./")

    def get(self, request):
        queryset, created = IndividualOptions.objects.get_or_create(
            user_id=request.user.id,
        )

        form = IndividualOptionsForm(
            initial={
                'user_id': request.user.id,
                'ignore_cable_type': tuple(queryset.ignore_cable_type.translate({ord(i): None for i in '[]\''}).split(', ')),
                'preselected_device_roles': IndividualOptions.objects.get(id=queryset.id).preselected_device_roles.all(),
                'preselected_tags': IndividualOptions.objects.get(id=queryset.id).preselected_tags.all(),
                'save_coords': queryset.save_coords,
                'show_unconnected': queryset.show_unconnected,
                'show_cables': queryset.show_cables, 
                'show_logical_connections': queryset.show_logical_connections,
                'show_single_cable_logical_conns': queryset.show_single_cable_logical_conns,
                'show_neighbors': queryset.show_neighbors,
                'show_circuit': queryset.show_circuit,
                'show_power': queryset.show_power,
                'show_wireless': queryset.show_wireless,
                'group_sites': queryset.group_sites,
                'group_locations': queryset.group_locations,
                'group_racks': queryset.group_racks,
                'group_virtualchassis': queryset.group_virtualchassis,
                'draw_default_layout': queryset.draw_default_layout,
                'straight_cables': queryset.straight_cables,
                'draw_termination_labels': queryset.draw_termination_labels,
                'draw_cable_labels': queryset.draw_cable_labels,
                'grid_size': queryset.grid_size,
                'node_label_items': tuple(queryset.node_label_items.translate({ord(i): None for i in '[]\''}).split(', ')),
            },
        )

        return render(
            request,
            "netbox_topology_views/individual_options.html",
            {
                "form": form,
                "object": queryset,
            },
        )


# ---------------------------------------------------------------------------
# Geographic views
# ---------------------------------------------------------------------------

def _build_geo_global_data(request):
    """Return JSON-serialisable data for the global geographic map view.

    Each site that has both latitude and longitude set becomes a node.
    Sites within the same region are given a shared group colour.
    Circuits whose both terminations resolve to a site create edges.
    """
    from dcim.models import Site

    sites = (
        Site.objects
        .restrict(request.user, 'view')
        .exclude(latitude=None)
        .exclude(longitude=None)
        .select_related('region')
    )

    # Map region → colour index for stable colouring
    region_ids = list({s.region_id for s in sites if s.region_id})
    region_color_map = {rid: i for i, rid in enumerate(sorted(region_ids))}
    COLORS = [
        '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
        '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
    ]

    nodes = []
    site_id_set = set()
    for site in sites:
        # Equirectangular projection centred at (0, 0)
        # Canvas width = 1800, height = 900 (arbitrary scale; vis-network zooms freely)
        x = (float(site.longitude) / 180.0) * 900
        y = -(float(site.latitude) / 90.0) * 450

        color_idx = region_color_map.get(site.region_id, len(COLORS) - 1) % len(COLORS)
        nodes.append({
            'id': site.pk,
            'label': site.name,
            'title': f"{site.name}\n{site.physical_address or ''}".strip(),
            'x': round(x, 1),
            'y': round(y, 1),
            'fixed': True,
            'color': COLORS[color_idx],
            'font': {'color': '#ffffff', 'size': 11},
            'shape': 'dot',
            'size': 12,
            'url': f'/dcim/sites/{site.slug}/',
            'site_id': site.pk,
        })
        site_id_set.add(site.pk)

    # Edges: circuits between two sites
    edges = []
    seen_edges = set()
    terminations = (
        CircuitTermination.objects
        .filter(_site_id__in=site_id_set)
        .select_related('circuit')
    )
    site_by_circuit: Dict[int, list] = {}
    for t in terminations:
        site_by_circuit.setdefault(t.circuit_id, []).append(t._site_id)

    for cid, site_ids in site_by_circuit.items():
        if len(site_ids) == 2:
            a, b = sorted(site_ids)
            key = (a, b)
            if key not in seen_edges:
                seen_edges.add(key)
                edges.append({'from': a, 'to': b})

    return {'nodes': nodes, 'edges': edges}


def _build_geo_site_data(request, site_id, group_id=None):
    """Return JSON-serialisable data for the per-site geographic view.

    Devices in the given site become nodes. Existing Coordinate records for
    the selected group provide x/y positions; unpositioned devices cluster at (0,0).
    """
    from dcim.models import Site

    site = get_object_or_404(Site, pk=site_id)

    devices = (
        Device.objects
        .restrict(request.user, 'view')
        .filter(site=site)
        .select_related('device_type', 'role', 'primary_ip4', 'primary_ip6')
    )

    # Load saved coordinates for this group
    coord_map: Dict[int, tuple] = {}
    selected_group = None
    if group_id:
        try:
            selected_group = CoordinateGroup.objects.get(pk=group_id)
            for c in Coordinate.objects.filter(group=selected_group, device__site=site):
                coord_map[c.device_id] = (c.x, c.y)
        except CoordinateGroup.DoesNotExist:
            pass

    nodes = []
    for device in devices:
        x, y = coord_map.get(device.pk, (0, 0))
        ip = ''
        if device.primary_ip4:
            ip = str(device.primary_ip4.address.ip)
        elif device.primary_ip6:
            ip = str(device.primary_ip6.address.ip)
        nodes.append({
            'id': device.pk,
            'label': device.name or f'Device #{device.pk}',
            'title': f"{device.name}\n{device.device_type}\n{ip}".strip(),
            'x': x,
            'y': y,
            'fixed': bool(coord_map.get(device.pk)),
            'color': '#4e79a7',
            'font': {'color': '#ffffff', 'size': 11},
            'shape': 'dot',
            'size': 10,
            'url': f'/dcim/devices/{device.pk}/',
        })

    # Edges: cables between devices in this site
    edges = []
    device_ids = {n['id'] for n in nodes}
    seen_edges = set()
    # CableTermination stores device id in _device_id (generic termination pattern)
    terminations = CableTermination.objects.filter(
        _device_id__in=device_ids
    )
    cable_ends: Dict[int, list] = {}
    for t in terminations:
        cable_ends.setdefault(t.cable_id, []).append(t._device_id)
    for cable_id, dev_ids in cable_ends.items():
        unique_devs = list(set(d for d in dev_ids if d in device_ids))
        if len(unique_devs) == 2:
            a, b = sorted(unique_devs)
            key = (a, b)
            if key not in seen_edges:
                seen_edges.add(key)
                edges.append({'from': a, 'to': b})

    # Coordinate groups for the selector
    groups = list(CoordinateGroup.objects.values('id', 'name', 'background_image_url'))

    return {
        'nodes': nodes,
        'edges': edges,
        'site': {
            'id': site.pk,
            'name': site.name,
            'slug': site.slug,
        },
        'groups': groups,
        'selected_group_id': selected_group.pk if selected_group else None,
        'background_image_url': selected_group.background_image_url if selected_group else '',
    }


class GeoGlobalView(PermissionRequiredMixin, View):
    """World map view — all sites with lat/lon plotted on an equirectangular projection."""

    permission_required = ('dcim.view_site',)

    def get(self, request):
        geo_data = _build_geo_global_data(request)
        return render(request, 'netbox_topology_views/geo_global.html', {
            'geo_data': json.dumps(geo_data),
        })


class GeoSiteView(PermissionRequiredMixin, View):
    """Per-site device layout view with optional background image overlay."""

    permission_required = ('dcim.view_device',)

    def get(self, request, site_id):
        group_id = request.GET.get('group') or None
        geo_data = _build_geo_site_data(request, site_id, group_id)
        return render(request, 'netbox_topology_views/geo_site.html', {
            'geo_data': json.dumps(geo_data),
            'site_name': geo_data['site']['name'],
            'groups': geo_data['groups'],
            'selected_group_id': geo_data['selected_group_id'],
        })
