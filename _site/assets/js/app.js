(function($) {

	var cluster = {
		_info: {
			host: '',
			name: 'Not Connected',
			status: 'red',
			version: {
				major: null,
				minor: null,
				patch: null
			},
			master_node: null
		},
		_is_refreshing: false,
		_last_update: null,
		_refresh_interval: 10000,
		_interval_id: null,

		init: function() {
			var self = this;

			// Set default configs
			if ( '/_plugin/netforest' == window.location.pathname.substr(0,16) ) {
				// Running as ES site plugin
				self._info.host = window.location.protocol + '//' + window.location.host;
			} else {
				// Running elsewhere
				self._info.host = '';
			}
			$( '#navbar-clusterconfig-host' ).val( self._info.host );
			self._refresh_interval = 5000;
			$( '#navbar-clusterconfig-refresh' ).val( self._refresh_interval / 1000 );

			self.render();
			nodes.init();
			indices.init();
			segments.init();

			// Get data
			self.refresh();

			// Actions
			$( '#navbar-clustername-statusicon' ).on( 'click', function() {
				var element = $( this );
				var config_panel = $( '#navbar-clusterconfig' );

				if ( element.hasClass( 'configure' ) ) {
					config_panel.slideUp( 'fast' );
					element.removeClass( 'configure' );
				} else {
					config_panel.slideDown( 'fast', function() {
						$( '#navbar-clusterconfig-host' ).focus();
					} );
					element.addClass( 'configure' );
				}
			} );

			$( '#navbar-clusterconfig-update' ).on( 'submit', function(event) {
				event.preventDefault();

				var need_refresh = false;
				var host = $( '#navbar-clusterconfig-host' ).val();
				if ( '' != host ) {
					host = host.replace(/\/$/g, "");
					if ( null == host.match(/^https?:\/\//) )
						host = 'http://' + host;
					if ( null == host.match(/:[0-9]*$/) )
						host += ':9200';

					$( '#navbar-clusterconfig-host' ).val( host );
				}
				if ( self._info.host != host ) {
					self._info.host = host;
					need_refresh = true;
				}

				var refresh = $( '#navbar-clusterconfig-refresh' ).val() * 1000;
				if ( self._refresh_interval != refresh ) {
					self._refresh_interval = refresh;
					need_refresh = true;
				}

				if ( need_refresh ) {
					self.refresh();
				}

				$( '#navbar-clustername-statusicon' ).removeClass( 'configure' );
				$( '#navbar-clusterconfig' ).slideUp( 'fast' );
			} );
		},

		refresh: function() {
			var self = this;

			if ( null != self._interval_id ) {
				window.clearInterval( self._interval_id );
			}

			nodes.reset();
			indices.reset();
			self._is_refreshing = false;

			if ( '' == self._info.host ) {
				self.set_info( {
					'status': 'red',
					'name': 'No Host Set'
				} );
				self.render();

				$( '#navbar-clustername-statusicon' ).addClass( 'configure' );
				$( '#navbar-clusterconfig' ).slideDown( 'fast', function() {
					$( '#navbar-clusterconfig-host' ).focus();
				} );

				return;
			}

			self._interval_id = window.setInterval( function() {
				self.sync_data();
			}, self._refresh_interval );

			self.sync_data();
		},

		set_info: function( info ) {
			var self = this;
			self._info = _.defaults( info, self._info );
			return self;
		},

		get_info: function() {
			var self = this;
			return self._info;
		},

		sync_data: function() {
			var self = this;

			if ( self._is_refreshing )
				return;

			self._is_refreshing = true;

			$.when(
				$.getJSON( cluster.get_info().host + '/' ),
				$.getJSON( cluster.get_info().host + '/_cluster/health' )
			)
			.done(function( result_root, result_health ) {
				// Get version
				self._info.version = _.object(
					['major','minor','patch'],
					result_root[0].version.number.split('.')
				);

				switch( result_health[0].status ) {
					case 'green':
						self.set_info( {
							'status': 'green',
							'name': result_health[0].cluster_name
						} );
						break;
					case 'yellow':
						self.set_info( {
							'status': 'yellow',
							'name': result_health[0].cluster_name
						} );
						break;
					case 'red':
						self.set_info( {
							'status': 'red',
							'name': result_health[0].cluster_name
						} );
						break;
					default:
						self.set_info( {
							'status': 'red',
							'name': 'Invalid Response'
						} );
						break;
				}
				self._is_refreshing = false;
				self._last_update = new Date();
				self.render();

				nodes.sync_data();
				indices.sync_data();
			})
			.fail(function() {
				self.set_info( {
					'status': 'red',
					'name': 'Not Connected'
				} );
				self._is_refreshing = false;
				self.render();
			});
		},

		render: function() {
			var self = this;

			if ( self._is_refreshing )
				return;

			$( '#navbar-clustername-name' )
				.text( self._info.name );
			$( '#navbar-clustername' )
				.removeClass( 'status-green status-yellow status-red' )
				.addClass( 'status-' + self._info.status )
		}
	};

	var nodes = {
		_svg: null,
		_svg_padding_x: 40,
		_svg_padding_y: 20,
		_svg_width: 860,
		_svg_height: 260,
		_nodes: {},
		_node_shards: {},
		_selected: null,
		_hover: null,
		_is_refreshing: false,
		_last_update: null,
		_pause: false,

		init: function() {
			var self = this;

			self._svg = d3
				.select( '#nodes-svg' )
				.attr( 'width', self._svg_width + self._svg_padding_x * 2 )
				.attr( 'height', self._svg_height + self._svg_padding_y * 2 )
				.attr( 'viewBox', "0 0 " + (self._svg_width + self._svg_padding_x * 2) + " " + (self._svg_height + self._svg_padding_y * 2) )
				.attr( 'preserveAspectRatio', "xMidYMid" )
				.append( 'g' );

			self.resize();
			$(window).on("resize", function() {
				self.resize();
			} );

			$( '#nodes-filter' ).keyup( function() {
				self.render();
			} );

			// Set hover events
			$( document ).on( 'mouseover', '#nodes-svg .node', function() {
				var node = $( this ).data( 'node' );
				self._hover = node.id;
				self._write_out_info_cells(
					node,
					$( '#nodes-info-footer tbody.inspect tr' )
				);
			} );

			
			$( '#nodes-svg' ).on( 'mouseover', '.disk', function( event ) {
				var element = $( this )

				self._pause = true;

				if ( !element.data( 'powertip-init' ) ) {
					element.powerTip( {
						manual: true,
						placement: 'e',
						smartPlacement: true
					} );
					element.data( 'powertip-init', true );
				}

				$.powerTip.show( this, event );
			} );
			$( '#nodes-svg' ).on( 'mouseleave', '.disk', function( event ) {
				$.powerTip.hide( this );
				self._pause = false;
			} );
		},

		reset: function() {
			var self = this;
			self._selected = null;
			self._hover = null;
			self._is_refreshing = false;
		},

		_write_out_info_cells: function( node, tr ) {
			if ( null == node )
				return;

			tr.children( '.col-name' ).text( node.name );
			tr.children( '.col-ver' ).text( node.version );
			tr.children( '.col-total' ).text( d3.format( '.3s' )( node.size.disk ) + 'B' );
			tr.children( '.col-free' ).text( d3.format( '.3s' )( node.size.free ) + 'B' );
			tr.children( '.col-index' ).text( d3.format( '.3s' )( node.size.index ) + 'B' );
			tr.children( '.col-docs' ).text( d3.format( '.3s' )( node.docs.count ) );
			tr.children( '.col-ratio' ).text( d3.format( '.2f' )( node.docs.deleted_ratio * 100 ) + '%' );
		},

		get_node: function( node_id ) {
			var self = this;

			if ( undefined == self._nodes[ node_id ] )
				return false;
			else
				return self._nodes[ node_id ]
		},

		resize: function() {
			var self = this,
				aspect = (self._svg_width + self._svg_padding_x * 2) / (self._svg_height + self._svg_padding_y * 2),
				chart = $("#nodes-svg"),
				targetWidth = chart.parent().width();
			chart.attr("width", targetWidth);
			chart.attr("height", targetWidth / aspect);
		},

		sync_data: function() {
			var self = this;

			if ( self._is_refreshing || self._pause )
				return;

			self._is_refreshing = true;

			var endpoints = [
				cluster.get_info().host + '/_nodes/_all/attributes',
				cluster.get_info().host + '/_nodes/stats/indices,fs',
				cluster.get_info().host + '/_cluster/state/master_node'
			];

			if ( 0 == cluster.get_info().version.major ) {
				endpoints = [
					cluster.get_info().host + '/_nodes',
					cluster.get_info().host + '/_nodes/stats?fs=true',
					cluster.get_info().host + '/_cluster/state?filter_blocks=true&filter_routing_table=true&filter_metadata=true'
				];
			}

			$.when(
				$.getJSON( endpoints[0] ),
				$.getJSON( endpoints[1] ),
				$.getJSON( endpoints[2] )
			)
			.done(function( result_nodes, result_nodes_stats, result_cluster_state ) {

				// Set Master Node ID
				cluster.set_info( {
					'master_node': result_cluster_state[0].master_node
				} );

				// Set data
				_.each( result_nodes[0].nodes, function( node, node_id ) {
					self._nodes[ node_id ] = _.defaults( node, self._nodes[ node_id ] );
				} );

				_.each( result_nodes_stats[0].nodes, function( node, node_id ) {
					var data = _.pick(
						node,
						[ 'name', 'transport_address', 'host', 'attributes' ]
					);

					if ( 0 == cluster.get_info().version.major )
						data.host = node.hostname;

					data.size = {
						'disk': node.fs.total.total_in_bytes,
						'free': node.fs.total.free_in_bytes,
						'system': node.fs.total.total_in_bytes - node.fs.total.free_in_bytes - node.indices.store.size_in_bytes,
						'index': node.indices.store.size_in_bytes
					};

					data.docs = {
						'count': node.indices.docs.count,
						'deleted': node.indices.docs.deleted,
						'deleted_ratio': get_deleted_ratio( node.indices.docs.count, node.indices.docs.deleted )
					}

					// Set metadata
					data.id = node_id;
					data.sortkey = data.host.split('.').reverse().join('.') + ' ' + data.name;

					self._nodes[ node_id ] = _.defaults( data, self._nodes[ node_id ] );
				} );

				// Remove non-existant nodes
				var dead_nodes = _.difference(
					_.keys( self._nodes ),
					_.union(
						_.keys( result_nodes[0].nodes ),
						_.keys( result_nodes_stats[0].nodes )
					)
				);
				self._nodes = _.omit( self._nodes, dead_nodes );

				self._is_refreshing = false;
				self._last_update = new Date();

				self.render();
			})
			.fail(function() {
				self._is_refreshing = false;
			});
		},

		

		render: function() {
			var self = this;

			if ( self._is_refreshing || self._pause )
				return;

			self._update_cluster_totals();

			if ( null != self._selected ) {
				self._write_out_info_cells(
					self._nodes[ self._selected ],
					$( '#nodes-info-footer tbody.monitor tr' )
				);
				self._highlighted_shards_for_node( self._selected );
			}

			if ( null != self._hover ) {
				self._write_out_info_cells(
					self._nodes[ self._hover ],
					$( '#nodes-info-footer tbody.inspect tr' )
				);
			}

			var filtered_nodes = self._get_filtered_nodes(),
				node_x = d3
					.scale
					.linear()
					.range( [ 0, self._svg_width ] )
					.domain( [ 0, filtered_nodes.nodes.length ] ),
				node_h = d3
					.scale
					.linear()
					.range( [ self._svg_height, 0 ] )
					.domain( [ 0, d3.max( filtered_nodes.nodes, function(d) { return d.size.disk; } ) ] ),
				node_axis = d3
					.svg
					.axis()
					.scale( node_h )
					.orient( "left" )
					.ticks( 5 )
					.tickFormat( function(d) { return d3.format( '.2s' )( d ) + 'B' } ),
				ratio_y = d3
					.scale
					.linear()
					.range( [ self._svg_height, 0 ] )
					.domain( [ 0, 0.5 ] ),
				ratio_line = d3
					.svg
					.line()
					.x( function(d, i) { return node_x( i + 0.5 ); } )
					.y( function(d) { return ratio_y( d.docs.deleted_ratio ); } ),
				
				click_event = function( element, d ) {
					var e = d3.event,
						g = element.parentNode,
						isSelected = d3.select( g ).classed( "selected" );

					// Unselect everything else
					d3.selectAll( 'g.selected' ).classed( "selected", false );
					
				};


			

			self._svg
				.selectAll( 'g' )
				.remove();

			var node_g = self._svg
				.selectAll( '.node' )
				.data( filtered_nodes.nodes, function(d) { return d.id; } )
				.enter()
				.append( 'g' )
				.attr("transform", "translate("+self._svg_padding_x+","+self._svg_padding_y+")")
				.attr( 'data-node', function(d) { return JSON.stringify( d ); } )
				.attr( 'class', function(d) {
					var class_names = 'node';
					if ( undefined != self._node_shards[ d.id ] ) {
						if ( self._node_shards[ d.id ].UNASSIGNED.length )
							class_names += ' shard-state-unassigned'; // unpossible
						if ( self._node_shards[ d.id ].INITIALIZING.length )
							class_names += ' shard-state-initializing';
						if ( self._node_shards[ d.id ].RELOCATING.length )
							class_names += ' shard-state-relocating';
					}
					if ( self._selected == d.id ) {
						class_names += ' selected';
					}
					return class_names
				} )
				.attr( 'id', function(d) { return 'node-' + d.id; } );

			// Index size
			node_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return node_x( i + 1/10 );
				} )
				.attr( "y", function( d ) {
					return node_h( d.size.index );
				}  )
				.attr( "width", node_x( 1 - 2/10 ) )
				.attr( "height", function( d ) {
					return self._svg_height - node_h( d.size.index );
				} )
				.classed( { 'index': true } );

			// System size
			node_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return node_x( i + 1/10 );
				} )
				.attr( "y", function( d ) {
					return node_h( d.size.index + d.size.system );
				}  )
				.attr( "width", node_x( 1 - 2/10 ) )
				.attr( "height", function( d ) {
					return self._svg_height - node_h( d.size.system );
				} )
				.classed( { 'system': true } );

			// Free disk
			node_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return node_x( i + 1/10 );
				} )
				.attr( "y", function( d ) {
					return node_h( d.size.index + d.size.system + d.size.free );
				}  )
				.attr( "width", node_x( 1 - 2/10 ) )
				.attr( "height", function( d ) {
					return self._svg_height - node_h( d.size.free );
				} )
				.classed( { 'free': true } );

			// Disk size, a.k.a. overlay on the entire node column
			node_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return node_x( i + 1/10 );
				} )
				.attr( "y", function( d ) {
					return node_h( d.size.disk );
				}  )
				.attr( "width", node_x( 1 - 2/10 ) )
				.attr( "height", function( d ) {
					return self._svg_height;
				} )
				.attr( 'data-powertip', function(d) {
					var tooltip = '<strong>' + d.name + '</strong>';
					tooltip += d3.format( '.3s' )( d.size.index ) + 'B Index';
					tooltip += '<br>' + d3.format( '.2f' )( d.docs.deleted_ratio * 100 ) + '% Deleted';

					if ( undefined != self._node_shards[ d.id ] ) {
						tooltip += '<br>' + self._node_shards[ d.id ].STARTED.length + ' Shards';
						if ( self._node_shards[ d.id ].INITIALIZING.length > 0 ) {
							tooltip += ', ' + self._node_shards[ d.id ].INITIALIZING.length + ' Initializing';
						}
						if ( self._node_shards[ d.id ].RELOCATING.length > 0 ) {
							tooltip += ', ' + self._node_shards[ d.id ].RELOCATING.length + ' Relocating Away';
						}
					}

					return tooltip;
				} )
				.classed( { 'disk': true } )
				.on( "click", function( d ) {
					click_event( this, d );
				} );

			self._svg
				.append("g")
				.attr("class", "y axis")
				.attr("transform", "translate("+self._svg_padding_x+","+self._svg_padding_y+")")
				.call(node_axis)
				.selectAll("text")
				.attr("dy", "1em")
				.attr("transform", "rotate(45)");

			

			self._svg
				.append("g")
				.attr("class", "y axis ratio")
				.attr("transform", "translate("+(self._svg_width+self._svg_padding_x)+","+self._svg_padding_y+")")
				.call(ratio_axis);
		},

		
		_get_filtered_nodes: function() {
			var self = this;
			var counts = {
				'total': _.keys( self._nodes ).length,
				'data': 0,
				'filtered': 0,
			};

			// Get only data nodes
			var data_nodes = _.filter( self._nodes, function( node ) {
				if ( undefined == node.attributes )
					return true;
				return ( "false" != node.attributes.data );
			} );
			counts.data = data_nodes.length;

			

			// Sort nodes
			data_nodes.sort( function( a, b ) {
				return alphanum( a.sortkey, b.sortkey );
			} );

			return {
				'counts': counts,
				'nodes': data_nodes
			};
		},

		_update_cluster_totals: function() {
			var self = this,
				cluster_version = '',
				cluster_version_mixed = false,
				cluster_totals = {
					'disk': 0,
					'free': 0,
					'index': 0,
					'docs': 0,
					'deleted': 0
				};

			_.each( self._nodes, function( node ) {
				if ( '' == cluster_version )
					cluster_version = node.version;
				if ( cluster_version != node.version )
					cluster_version_mixed = true;

				cluster_totals.disk += node.size.disk;
				cluster_totals.free += node.size.free;
				cluster_totals.index += node.size.index;
				cluster_totals.docs += node.docs.count;
				cluster_totals.deleted += node.docs.deleted;
			} );

			var tr = $( '#nodes-info-footer tbody.totals tr' );
			tr.children( '.col-name' ).html(
				'<em>Cluster &mdash; ' + self._nodes[ cluster.get_info().master_node ].name + '</em>'
			);
			if ( cluster_version_mixed )
				tr.children( '.col-ver' ).html( '<em>Mixed!</em>' );
			else
				tr.children( '.col-ver' ).text( cluster_version );
			tr.children( '.col-total' ).text( d3.format( '.3s' )( cluster_totals.disk ) + 'B' );
			tr.children( '.col-free' ).text( d3.format( '.3s' )( cluster_totals.free ) + 'B' );
			tr.children( '.col-index' ).text( d3.format( '.3s' )( cluster_totals.index ) + 'B' );
			tr.children( '.col-docs' ).text( d3.format( '.3s' )( cluster_totals.docs ) );
			tr.children( '.col-ratio' ).text( d3.format( '.2f' )( get_deleted_ratio( cluster_totals.docs, cluster_totals.deleted ) * 100 ) + '%' );
		}
	};

	var indices = {
	

		init: function() {
			var self = this;

			self._svg = d3
				.select( '#indices-svg' )
				.attr( 'width', self._svg_width + self._svg_padding_x * 2 )
				.attr( 'height', self._svg_height + self._svg_padding_y * 2 )
				.attr( 'viewBox', "0 0 " + (self._svg_width + self._svg_padding_x * 2) + " " + (self._svg_height + self._svg_padding_y * 2) )
				.attr( 'preserveAspectRatio', "xMidYMid" )
				.append( 'g' );

			self.resize();
			$(window).on("resize", function() {
				self.resize();
			} );

			$( '#indices-filter' ).keyup( function() {
				self.render();
			} );

			
		},

		reset: function() {
			var self = this;
			self._selected = {
				index: null,
				shard: null
			};
			self._hover = {
				index: null,
				shard: null
			};
			self._highlight_shards = {};
			self._is_refreshing = false;
		},

		

		resize: function() {
			var self = this,
				aspect = (self._svg_width + self._svg_padding_x * 2) / (self._svg_height + self._svg_padding_y * 2),
				chart = $("#indices-svg"),
				targetWidth = chart.parent().width();
			chart.attr("width", targetWidth);
			chart.attr("height", targetWidth / aspect);
		},

		};

	var segments = {
		/*_svg_padding_x: 40,
		_svg_padding_y: 20,
		_svg_width: 390,
		_svg_height: 150,
		_segment_size: {
			min: 0,
			max: 0
		},*/
		_rendered: {
			index: null,
			shard_num: null
		},
		_resize: {
			aspect_ratio: null,
			width: null,
			height: null
		},
		_pause: false,

		init: function() {
			var self = this;

			self._resize.aspect_ratio = ( self._svg_width + self._svg_padding_x * 2 ) / ( self._svg_height + self._svg_padding_y * 2 );
			self._resize.width = self._svg_width + self._svg_padding_x * 2,
			self._resize.height = self._resize.width / self._resize.aspect_ratio;

			self.resize();
			$(window).on("resize", function() {
				self.resize();
			} );

			$( document ).on( 'mouseover', '#segments-rendered .segment', function( event ) {
				var element = $( this )

				self._pause = true;

				if ( !element.data( 'powertip-init' ) ) {
					element.powerTip( {
						manual: true,
						placement: 's',
						smartPlacement: true
					} );
					element.data( 'powertip-init', true );
				}

				$.powerTip.show( this, event );
			} );
			$( document ).on( 'mouseleave', '#segments-rendered .segment', function( event ) {
				$.powerTip.hide( this );
				self._pause = false;
			} );
		},

		resize: function() {
			var self = this,
				charts = $(".segments-svg"),
				target = $('#segments-rendered');

			self._resize.width = target.width() / 2,
			self._resize.height = self._resize.width / self._resize.aspect_ratio;

			charts.attr("width", self._resize.width);
			charts.attr("height", self._resize.height);
		},

		/*clear_segments: function() {
			$( '#segments-rendered' ).html( '' );
			self._rendered = {
				index: null,
				shard_num: null
			};
		},

		draw_segments_for: function( index, shard_num ) {
			var self = this;

			if ( self._pause )
				return;

			$.when(
				$.getJSON( cluster.get_info().host + '/' + index + '/_segments' )
			)
			.done(function( results ) {

				if ( null == shard_num ) {
					var shards = results.indices[ index ][ 'shards' ];
				} else {
					var shards = _.pick( results.indices[ index ][ 'shards' ], shard_num );
				}

				var primary_shard_segments = {};
				_.each( shards, function( shard, shard_num ) {
					_.each( shard, function( shard_instance, index ) {
						var sortkey;
						if ( shard_instance.routing.primary ) {
							sortkey = 'P ';
						} else {
							sortkey = 'R '
						}

						var node = nodes.get_node( shard_instance.routing.node );
						if ( node )
							sortkey += node.sortkey;

						shards[ shard_num ][ index ][ 'sortkey' ] = sortkey;
						shards[ shard_num ][ index ][ 'nodename' ] = node.name;

						if ( shard_instance.routing.primary ) {
							primary_shard_segments[ shard_num ] = _.keys( shard_instance.segments );
						}
					} );

					shards[ shard_num ].sort( function( a, b ) {
						return alphanum( a.sortkey, b.sortkey );
					} );
				} );

				_.each( shards, function( shard, shard_num ) {
					_.each( shard, function( shard_instance, index ) {
						_.each( shard_instance.segments, function( segment, segment_id ) {
							shards[ shard_num ][ index ][ 'segments' ][ segment_id ][ 'id' ] = segment_id;
							shards[ shard_num ][ index ][ 'segments' ][ segment_id ][ 'on_primary' ] = ( _.indexOf( primary_shard_segments[ shard_num ], segment_id ) >= 0 );
							shards[ shard_num ][ index ][ 'segments' ][ segment_id ][ 'deleted_ratio' ] = get_deleted_ratio( segment.num_docs, segment.deleted_docs );
						} );
					} );
				} );

				self._render( index, shard_num, shards );
			} );
		},

		_render: function( index, shard_num, shards ) {
			var self = this,
				redraw = false;

			if ( self._pause )
				return;

			if ( self._rendered.index != index || self._rendered.shard_num != shard_num ) {
				var html = '';
				_.each( shards, function( shard, shard_num ) {
					html += '<h3>Index:' + index + ' &mdash; Shard:' + shard_num + '</h3>';
					_.each( shard, function( shard_instance, index ) {
						html += '<svg class="segments-svg" id="segments-rendered-' + index + '-' + shard_num + '-' + shard_instance.routing.node + '" />';
					} );
				} );
				$( '#segments-rendered' ).html( html );
				self._rendered = {
					index: index,
					shard_num: shard_num
				};
				redraw = true;
			}

			self._segment_size = {
				min: null,
				max: null
			};
			self._max_num_segments = 0;
			_.each( shards, function( shard, shard_num ) {
				self._max_num_segments = Math.max(
					self._max_num_segments,
					d3.max( shard, function(d) { return _.keys( d.segments ).length; } )
				);
				_.each( shard, function( shard_instance, index ) {
					if ( 0 == _.keys( shard_instance.segments ).length )
						return;

					if ( null == self._segment_size.min ) {
						self._segment_size = {
							min: d3.min( _.values( shard_instance.segments ), function(d) { return d.size_in_bytes; } ),
							max: d3.max( _.values( shard_instance.segments ), function(d) { return d.size_in_bytes; } )
						};
					} else {
						self._segment_size.min = Math.min(
							self._segment_size.max,
							d3.min( _.values( shard_instance.segments ), function(d) { return d.size_in_bytes; } )
						);
						self._segment_size.max = Math.max(
							self._segment_size.max,
							d3.max( _.values( shard_instance.segments ), function(d) { return d.size_in_bytes; } )
						);
					}
				} );
			} );

			if ( self._segment_size.min == self._segment_size.max )
				self._segment_size.min = 0;

			_.each( shards, function( shard, shard_num ) {
				_.each( shard, function( shard_instance, index ) {
					self._render_shard( index, shard_num, shard_instance );
				} );
			} );

			if ( redraw )
				self.resize();
		},

		_render_shard: function( index, shard_num, shard_instance ) {
			var self = this,
				segments = _.values( shard_instance.segments ),
				segment_x = d3
					.scale
					.linear()
					.range( [ 0, self._svg_width ] )
					.domain( [ 0, self._max_num_segments ] ),
				segment_y = d3
					.scale
					.log()
					.clamp( true )
					.nice()
					.range( [ self._svg_height, 0 ] )
					.domain( [ self._segment_size.max/10000, self._segment_size.max ] ),
				segment_axis = d3
					.svg
					.axis()
					.scale( segment_y )
					.orient( "left" )
					.ticks( 1, function(d) { return d3.format( '.1s' )( d ) + 'B' } ),
				ratio_y = d3
					.scale
					.linear()
					.range( [ self._svg_height, 0 ] )
					.domain( [ 0, 0.5 ] ),
				ratio_line = d3
					.svg
					.line()
					.x( function(d, i) { return segment_x( i + 0.5 ); } )
					.y( function(d) { return ratio_y( d.deleted_ratio ); } ),
				ratio_axis = d3
					.svg
					.axis()
					.scale( ratio_y )
					.orient( "right" )
					.ticks( 5 )
					.tickFormat( function(d) { return Math.round( d * 100 ) + '%' } )
				svg = d3
					.select( '#segments-rendered-' + index + '-' + shard_num + '-' + shard_instance.routing.node );

			// Sort segments
			segments.sort( function( a, b ) {
				if ( b.size_in_bytes != a.size_in_bytes ) {
					// Large -> Small size; small shards merge into larger ones
					return b.size_in_bytes - a.size_in_bytes;
				} else if ( b.deleted_ratio != a.deleted_ratio ) {
					// Less -> More deleted; more deleted more likely to merge
					return a.deleted_ratio - b.deleted_ratio;
				} else {
					// Older -> Newer gen; newer gen from new merges / created
					return a.generation - b.generation
				}
			} );

			if ( undefined == svg.attr( 'preserveAspectRatio' ) ) {
				svg
					.attr( 'width', self._svg_width + self._svg_padding_x * 2 )
					.attr( 'height', self._svg_height + self._svg_padding_y * 2 )
					.attr( 'viewBox', "0 0 " + ( self._svg_width + self._svg_padding_x * 2 ) + " " + ( self._svg_height + self._svg_padding_y * 2 ) )
					.attr( 'preserveAspectRatio', "xMidYMid" );
			}

			svg
				.selectAll( 'g' )
				.remove();
			svg
				.selectAll( 'text' )
				.remove();

			var segment_g = svg
				.selectAll( '.segment' )
				.data( segments, function(d) {
					return index + '-' + shard_num + '-' + shard_instance.routing.node + '-' + d.id;
				} )
				.enter()
				.append( 'g' )
				.attr( "transform", "translate("+self._svg_padding_x+","+self._svg_padding_y+")" )
				.attr( 'data-segment', function(d) { return JSON.stringify( d ); } )
				.attr( 'data-powertip', function(d) {
					var tooltip = '<strong>' + d.id + '</strong>';

					if ( d.committed && d.search && d.on_primary ) {
						tooltip += 'Synced (Primary)';
					} else if ( d.committed && d.search ) {
						tooltip += 'Synced';
					} else if ( d.committed ) {
						tooltip += 'Committed';
					} else {
						tooltip += 'Uncommitted';
					}

					tooltip += '<br>' + d3.format( '.3s' )( d.size_in_bytes ) + 'B';
					tooltip += '<br>' + d3.format( '.3s' )( d.num_docs ) + ' Docs';
					tooltip += '<br>' + d3.format( '.2f' )( d.deleted_ratio * 100 ) + '% Deleted';
					return tooltip;
				} )
				.attr( 'class', function(d) {
					var class_names = 'segment';

					if ( d.committed && d.search && d.on_primary ) {
						class_names += ' synced-primary';
					} else if ( d.committed && d.search ) {
						class_names += ' synced-local';
					} else if ( d.committed ) {
						class_names += ' committed';
					} else {
						class_names += ' uncommitted';
					}
					return class_names
				} )
				.attr( 'id', function(d) { return 'segment-' + index + '-' + shard_num + '-' + shard_instance.routing.node + '-' + d.id; } );

			segment_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return segment_x( i );
				} )
				.attr( "y", 0 )
				.attr( "width", segment_x( 1 ) )
				.attr( "height", self._svg_height )
				.classed( { 'hover-target': true } );

			segment_g
				.append( 'rect' )
				.attr( "x", function( d, i ) {
					return segment_x( i + 1/10 );
				} )
				.attr( "y", function( d ) {
					return segment_y( d.size_in_bytes );
				}  )
				.attr( "width", segment_x( 1 - 2/10 ) )
				.attr( "height", function( d ) {
					return self._svg_height - segment_y( d.size_in_bytes ) + 1;
				} )
				.classed( { 'size': true } );

			svg
				.append("g")
				.attr("class", "y axis")
				.attr("transform", "translate("+self._svg_padding_x+","+self._svg_padding_y+")")
				.call(segment_axis)
				.selectAll("text")
				.attr("dy", "1em")
				.attr("transform", "rotate(45)");

			// Delete ratio
			var ratio_g = svg
				.append( 'g' )
				.attr( 'class', 'node_ratio' )
				.attr("transform", "translate("+self._svg_padding_x+","+self._svg_padding_y+")");

			ratio_g
				.append("path")
				.datum(segments)
				.attr("class", "line")
				.attr("d", ratio_line);

			ratio_g
				.selectAll('circle')
				.data(segments)
				.enter()
				.append('circle')
				.attr("cx", function(d, i) { return segment_x( i + 0.5 ); } )
				.attr("cy", function(d) { return ratio_y( d.deleted_ratio ); } )
				.attr("r", 1.5)
				.attr("class", "line-point");

			svg
				.append("g")
				.attr("class", "y axis ratio")
				.attr("transform", "translate("+(self._svg_width+self._svg_padding_x)+","+self._svg_padding_y+")")
				.call(ratio_axis);

			var label = shard_instance.nodename;
			if ( shard_instance.routing.primary )
				label += ' (Primary)';
			else
				label += ' (Replica)';
			svg
				.append( "text" )
				.attr( "x", (self._svg_width / 2) + self._svg_padding_x )
				.attr( "y", self._svg_height + self._svg_padding_y * 1.75 )
				.attr( "text-anchor", "middle" )
				.text( label );

		}
	*/};
    
	var alphanum = function(a, b) {
		function chunkify(t) {
			var tz = [], x = 0, y = -1, n = 0, i, j;

			while (i = (j = t.charAt(x++)).charCodeAt(0)) {
				var m = (i == 46 || (i >=48 && i <= 57));
				if (m !== n) {
					tz[++y] = "";
					n = m;
				}
				tz[y] += j;
			}
			return tz;
		}

		var aa = chunkify(a);
		var bb = chunkify(b);

		for (x = 0; aa[x] && bb[x]; x++) {
			if (aa[x] !== bb[x]) {
				var c = Number(aa[x]), d = Number(bb[x]);
				if (c == aa[x] && d == bb[x])
					return c - d;
				else
					return (aa[x] > bb[x]) ? 1 : -1;
			}
		}
		return aa.length - bb.length;
	}

	var get_deleted_ratio = function( docs, deleted ) {
		if ( 0 == deleted )
			return 0;
		else
			return deleted / ( docs + deleted );
	}

	$( function() {
		cluster.init();
		$.fn.powerTip.smartPlacementLists.e = ['e', 'w', 'ne', 'se', 'nw', 'sw', 'n', 's', 'e'];
	} );
})(jQuery);
